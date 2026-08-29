import { strToU8, zipSync } from 'fflate';
import type {
  Agent,
  Skill,
  RepoRef,
  CiExportInput,
  CiPreview,
  CiExport,
  CiInstallation,
  CiInstallationStatus,
  CiTarget,
  CiPostAs,
  CiTrigger,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError, ExternalServiceError } from '../../platform/errors.js';
import { toAgentDto } from '../agents/helpers.js';
import { toSkillDto } from '../skills/helpers.js';
import { CiRepository } from './repository.js';
import { buildBundle } from './bundle.js';
import { EXPORT_BRANCH } from './constants.js';
import { toSlug } from './slug.js';

/**
 * `CiService` — Export-to-CI's preview/install/archive/status surface (T10).
 *
 * Onion rules: this file never imports `db/schema`/`drizzle-orm` directly (the
 * one DB-touching dependency, `CiRepository`, is injectable — see
 * `CiRepositoryLike` below — and defaults to a real, `container.db`-backed
 * instance exactly like `LocalReviewService` builds its own `ReviewRepository`
 * from `container.db`, server/insights/INSIGHTS.md 2026-08-18) and reaches
 * GitHub ONLY through `container.github()` (never a concrete adapter import).
 * `buildBundle`/`validateWorkflowYaml` (pure, from `./bundle.js`/`./workflow.js`)
 * are the single source of "what files does this agent export" — `preview`,
 * `exportToCi`, and `archive` all call the SAME function with the SAME
 * arguments, which is what makes AC-19 ("preview and export are byte-identical
 * for the same input") true by construction rather than by convention.
 */

/** Structural surface of `CiRepository` this service actually calls — lets a
 *  hermetic test inject an in-memory fake with no DB, no cast required (a
 *  `Pick<>` of a class's public methods is a plain object type, so a matching
 *  plain object literal satisfies it directly). */
export type CiRepositoryLike = Pick<
  CiRepository,
  'findInstallationByRepo' | 'upsertInstallation' | 'listInstallations'
>;

/** Body for `POST /agents/:id/ci-installations` (T13) — the explicit
 *  post-download confirmation (AC-31, spec Q6). Not a `@devdigest/shared`
 *  contract: it is exactly the wizard's Step-3 answers plus the chosen repo,
 *  with no `action`/`workflow_override` (those only make sense mid-export). */
export interface ConfirmInstallationInput {
  repo: string;
  target: CiTarget;
  base: string;
  post_as: CiPostAs;
  triggers: CiTrigger[];
}

/** REST-path-safe `owner/name` shape (AC-10, server-side mirror of the
 *  client's Step-1 validation) — this string is later split into GitHub API
 *  path segments, so it is checked here independently of the client. */
const REPO_SHAPE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** A segment made up ENTIRELY of dots (`.`, `..`, `...`, …) is not a
 *  legitimate GitHub owner or repo name, but `REPO_SHAPE` alone accepts it —
 *  `.`/`..` are valid characters in the class, and a whole segment of them
 *  still matches. Rejecting this shape closes a path-traversal hole: the
 *  validated string is later split on `/` into GitHub REST path segments
 *  (see `parseRepo`), so `../user` or `owner/..` would otherwise resolve to
 *  an arbitrary `api.github.com` endpoint called with the workspace PAT. */
const DOTS_ONLY_SEGMENT = /^\.+$/;

/** Redact GitHub token shapes from an error message before it is ever
 *  embedded in a thrown error (AC-53) — defense in depth on top of never
 *  stringifying a whole error/response object, only `.message`. */
const TOKEN_LIKE = /\b(?:ghp|gho|ghs|ghr|ghu|github_pat)_[A-Za-z0-9_]{10,}\b/g;

function sanitizeReason(reason: string): string {
  return reason.replace(TOKEN_LIKE, '[redacted]');
}

/** `owner/name` → `RepoRef`. Only ever called after `REPO_SHAPE` has already
 *  matched, which guarantees exactly one `/`. */
function parseRepo(repo: string): RepoRef {
  const slash = repo.indexOf('/');
  return { owner: repo.slice(0, slash), name: repo.slice(slash + 1) };
}

export class CiService {
  private repo: CiRepositoryLike;

  constructor(
    private container: Container,
    repo?: CiRepositoryLike,
  ) {
    this.repo = repo ?? new CiRepository(container.db);
  }

  /**
   * Step 2 preview: the complete, deterministic bundle with **zero** side
   * effects (AC-13) — no GitHub call, no repository write. Target/repo are
   * validated here too (not just at export time) so an invalid Step-1 answer
   * never reaches a "successful" preview.
   */
  async preview(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiPreview> {
    this.assertSupportedTarget(input.target);
    this.assertRepoShape(input.repo);

    const { agent, skills } = await this.loadAgentAndSkills(workspaceId, agentId);
    const runnerSource = await this.container.ciRunnerBundle.read();
    const files = buildBundle({
      agent,
      skills,
      runnerSource,
      input: { triggers: input.triggers, post_as: input.post_as },
      workflowOverride: input.workflow_override,
    });

    return { repo: input.repo, files };
  }

  /**
   * Step 4 "open a PR": generate the same bundle `preview` would (AC-19),
   * commit it onto `EXPORT_BRANCH`, reuse an already-open PR for that branch
   * (AC-27) or open a new one, then persist the installation — in that exact
   * order, so a GitHub failure (caught below) leaves **no** row (AC-32).
   */
  async exportToCi(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    this.assertSupportedTarget(input.target);
    this.assertRepoShape(input.repo);
    await this.assertNoConflict(workspaceId, agentId, input.repo);

    const { agent, skills } = await this.loadAgentAndSkills(workspaceId, agentId);
    const runnerSource = await this.container.ciRunnerBundle.read();
    const files = buildBundle({
      agent,
      skills,
      runnerSource,
      input: { triggers: input.triggers, post_as: input.post_as },
      workflowOverride: input.workflow_override,
    });

    const github = await this.container.github();
    const repoRef = parseRepo(input.repo);

    let prUrl: string;
    try {
      await github.commitFiles(repoRef, {
        branch: EXPORT_BRANCH,
        base: input.base,
        message: `DevDigest: export "${agent.name}" review workflow`,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      });

      const existingPr = await github.findOpenPr(repoRef, EXPORT_BRANCH);
      if (existingPr) {
        prUrl = existingPr.url;
      } else {
        const opened = await github.openPullRequest(repoRef, {
          title: `DevDigest: install "${agent.name}" CI review`,
          head: EXPORT_BRANCH,
          base: input.base,
          body: `Adds or updates the DevDigest review workflow for agent "${agent.name}".`,
        });
        prUrl = opened.url;
      }
    } catch (err) {
      throw this.wrapGithubError(input.repo, err);
    }

    // Only reached once both the commit and the PR step have resolved — a
    // rejection above throws before this line, so nothing is ever persisted
    // on a failed export (AC-32).
    const installation = await this.repo.upsertInstallation({
      agentId,
      repo: input.repo,
      targetType: input.target,
      agentVersion: agent.version,
      baseBranch: input.base,
      postAs: input.post_as,
      triggers: input.triggers,
    });

    return { installation, files, pr_url: prUrl };
  }

  /**
   * Step 4 "download": the same bundle, zipped, with **zero** GitHub calls
   * and **zero** DB writes (AC-30) — the installation row is only created by
   * the explicit `confirmInstallation` the client calls after the user says
   * "I installed these files" (AC-31, spec Q6).
   */
  async archive(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<{ filename: string; content_base64: string }> {
    this.assertSupportedTarget(input.target);
    this.assertRepoShape(input.repo);

    const { agent, skills } = await this.loadAgentAndSkills(workspaceId, agentId);
    const runnerSource = await this.container.ciRunnerBundle.read();
    const files = buildBundle({
      agent,
      skills,
      runnerSource,
      input: { triggers: input.triggers, post_as: input.post_as },
      workflowOverride: input.workflow_override,
    });

    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
      entries[file.path] = strToU8(file.contents);
    }
    const zipped = zipSync(entries);

    return {
      filename: `${toSlug(agent.name)}-devdigest-ci.zip`,
      content_base64: Buffer.from(zipped).toString('base64'),
    };
  }

  /**
   * The explicit post-download confirmation (AC-31) — the ONLY way the
   * download path ever creates an installation row. Runs the same
   * target/repo/conflict checks as `exportToCi` since it writes to the exact
   * same table, just without touching GitHub or regenerating the bundle (the
   * user already has the files from `archive`).
   */
  async confirmInstallation(
    workspaceId: string,
    agentId: string,
    body: ConfirmInstallationInput,
  ): Promise<CiInstallation> {
    this.assertSupportedTarget(body.target);
    this.assertRepoShape(body.repo);
    await this.assertNoConflict(workspaceId, agentId, body.repo);

    const agentRow = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agentRow) throw new NotFoundError(`Agent "${agentId}" not found`);
    const agent = toAgentDto(agentRow);

    return this.repo.upsertInstallation({
      agentId,
      repo: body.repo,
      targetType: body.target,
      agentVersion: agent.version,
      baseBranch: body.base,
      postAs: body.post_as,
      triggers: body.triggers,
    });
  }

  /** Per-installation status for the CI tab (AC-2, AC-3, AC-8) — `out_of_date`
   *  compares the version RECORDED on the installation against the agent's
   *  CURRENT version; the installation row itself is never touched here. */
  async installationStatuses(workspaceId: string, agentId: string): Promise<CiInstallationStatus[]> {
    const rows = await this.repo.listInstallations(workspaceId, agentId);
    return rows.map((row) => ({
      installation: row.installation,
      last_run: row.lastRun,
      out_of_date: row.installation.agent_version !== row.agentCurrentVersion,
    }));
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private async loadAgentAndSkills(
    workspaceId: string,
    agentId: string,
  ): Promise<{ agent: Agent; skills: Skill[] }> {
    const row = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!row) throw new NotFoundError(`Agent "${agentId}" not found`);
    const agent = toAgentDto(row);

    const linked = await this.container.agentsRepo.linkedSkills(agentId);
    const skills = linked.map((l) => toSkillDto(l.skill));

    return { agent, skills };
  }

  /** `target: 'jenkins'` (etc.) is rejected BEFORE anything else in every
   *  public method above (AC-12) — the target may already be a valid
   *  `CiTarget` enum member (Zod validated it at the route), but only "gha"
   *  is actually implemented. */
  private assertSupportedTarget(target: CiTarget): void {
    if (target !== 'gha') {
      throw new ValidationError(
        `CI target "${target}" is not supported yet — only GitHub Actions ("gha") is available`,
      );
    }
  }

  private assertRepoShape(repo: string): void {
    if (!REPO_SHAPE.test(repo)) {
      throw new ValidationError(`Invalid repository "${repo}" — expected the "owner/name" shape`);
    }
    const { owner, name } = parseRepo(repo);
    if (DOTS_ONLY_SEGMENT.test(owner) || DOTS_ONLY_SEGMENT.test(name)) {
      throw new ValidationError(`Invalid repository "${repo}" — expected the "owner/name" shape`);
    }
  }

  /** A4 (spec Q9): exactly one agent may be installed onto a given repo — a
   *  second, DIFFERENT agent exporting to the same repo is refused with a 409
   *  naming the agent that already owns it. Exporting the SAME agent again
   *  (the update path, AC-49/AC-50) is not a conflict. */
  private async assertNoConflict(workspaceId: string, agentId: string, repo: string): Promise<void> {
    const existing = await this.repo.findInstallationByRepo(workspaceId, repo);
    if (!existing || existing.agent_id === agentId) return;

    const otherRow = await this.container.agentsRepo.getById(workspaceId, existing.agent_id);
    const otherName = otherRow ? toAgentDto(otherRow).name : existing.agent_id;
    throw new AppError(
      'ci_repo_conflict',
      `Repository "${repo}" is already installed by a different agent ("${otherName}")`,
      409,
    );
  }

  private wrapGithubError(repo: string, err: unknown): ExternalServiceError {
    const rawReason = err instanceof Error ? err.message : String(err);
    return new ExternalServiceError(`GitHub export to "${repo}" failed: ${sanitizeReason(rawReason)}`);
  }
}
