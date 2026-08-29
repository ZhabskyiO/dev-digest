import {
  CiResultArtifact,
  type CiRun,
  type CiRunList,
  type CiRunsQuery,
  type GitHubClient,
  type RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ARTIFACT_FILE, ARTIFACT_NAME, WORKFLOW_PATH } from './constants.js';
import { CiRepository, type UpsertRunInput } from './repository.js';

/** Bare filename `listWorkflowRuns`'s `workflowFile` option expects — derived
 * from `WORKFLOW_PATH` so the two never drift. */
const WORKFLOW_FILE = WORKFLOW_PATH.split('/').pop()!;

/** A stored `ci_runs.status` value from a prior refresh that must not be
 * regressed and must not trigger a second artifact download (AC-44, R12).
 * `skipped` (review job never ran — fork PR or bootstrap) is terminal too:
 * a later refresh of the same `workflow_run_id` can't produce an artifact
 * retroactively, so re-downloading gains nothing. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'succeeded',
  'failed',
  'no_findings',
  'skipped',
]);

/** How long a `refresh()` result is reused before the next call is allowed to
 * hit GitHub again — keeps the R12 API budget honest when the CI tab and the
 * CI Runs page both poll inside the same window. Module-scoped (not a class
 * field) so the throttle holds across separate `CiIngestService` instances
 * built per request, which is how every other `modules/*\/service.ts` in this
 * codebase is constructed (`new XService(container)` per call). */
const REFRESH_THROTTLE_MS = 30_000;
const lastRefreshAt = new Map<string, number>();

function repoRefFor(repo: string): RepoRef {
  const [owner, name] = repo.split('/');
  return { owner: owner ?? '', name: name ?? '' };
}

function toDate(iso: string | null | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * T11 — pulls GitHub Actions workflow runs into `ci_runs`. This is the ONLY
 * caller of `GitHubClient.listWorkflowRuns`/`downloadRunArtifactFile` and the
 * ONLY producer of a `CiResultArtifact` parse — nothing else in this module
 * accepts one as input, so a `CiResultArtifact` never arrives from outside
 * DevDigest's own ingest loop (AC-39).
 *
 * Status is derived EXCLUSIVELY from the artifact WHEN AN ARTIFACT EXISTS,
 * never the run's GitHub `conclusion`/exit code (AC-42) — the runner exits
 * non-zero both when the fail-on gate trips (a working gate, `succeeded`)
 * and when it hard-fails, so `conclusion` must never override an artifact
 * that was actually downloaded and parsed.
 *
 * The ONE place `conclusion` IS read is the no-artifact branch: a completed
 * run with no artifact and a `success` conclusion means the review job was
 * itself skipped (a fork PR's `fork-notice` job, or this repo's own
 * bootstrap guard on the install PR before `.devdigest/` lands on the base
 * branch) rather than a genuine runner crash — that case is `skipped`, not
 * `failed`. Any other conclusion with no artifact stays `failed` as before.
 */
export class CiIngestService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  /** Reset the process-wide 30s throttle — test-only escape hatch so unrelated
   * test cases don't bleed a `lastRefreshAt` entry into one another. */
  static resetThrottleForTests(): void {
    lastRefreshAt.clear();
  }

  /**
   * Ingest every installation's recent workflow runs (optionally narrowed to
   * one agent), then return the same paginated view `list()` would. A GitHub
   * failure anywhere in the walk is caught and reported as `refresh_error`
   * WITHOUT throwing — every row ingested before the failure stays committed,
   * and rows for installations not yet reached are simply left as they were
   * (AC-45). `force` bypasses the 30s throttle; without it, a call inside the
   * window skips GitHub entirely and returns the current DB view unchanged.
   */
  async refresh(
    workspaceId: string,
    opts: { agentId?: string; force?: boolean } = {},
  ): Promise<CiRunList> {
    const cacheKey = `${workspaceId}:${opts.agentId ?? ''}`;
    const now = Date.now();
    const last = lastRefreshAt.get(cacheKey);
    const throttled = !opts.force && last !== undefined && now - last < REFRESH_THROTTLE_MS;

    let refreshError: string | null = null;
    if (!throttled) {
      lastRefreshAt.set(cacheKey, now);
      try {
        const installations = await this.repo.listInstallations(workspaceId, opts.agentId);
        const github = await this.container.github();
        for (const { installation } of installations) {
          await this.ingestInstallation(github, installation.id, installation.repo, installation.target_type);
        }
      } catch (err) {
        refreshError = errorMessage(err);
      }
    }

    const current = await this.list(workspaceId, { agent_id: opts.agentId });
    return { ...current, refresh_error: refreshError };
  }

  /** Read-only paginated/filtered view over already-ingested runs — never
   * calls GitHub. */
  async list(workspaceId: string, query: CiRunsQuery): Promise<CiRunList> {
    const { items, total } = await this.repo.listRuns(workspaceId, query);
    return { items, total, refresh_error: null };
  }

  /** One installation's worth of `listWorkflowRuns` + per-run reconciliation.
   * Exactly one `listWorkflowRuns` call; at most one `downloadRunArtifactFile`
   * call per run that isn't already stored as terminal (R12). */
  private async ingestInstallation(
    github: GitHubClient,
    installationId: string,
    repo: string,
    targetType: string,
  ): Promise<void> {
    const repoRef = repoRefFor(repo);
    const runs = await github.listWorkflowRuns(repoRef, {
      workflowFile: WORKFLOW_FILE,
      perPage: 20,
    });
    if (runs.length === 0) return;

    const storedStatuses = await this.repo.getRunStatuses(runs.map((r) => r.id));

    for (const run of runs) {
      const base: Omit<UpsertRunInput, 'status'> = {
        ciInstallationId: installationId,
        workflowRunId: run.id,
        prNumber: run.pr_number,
        ranAt: toDate(run.run_started_at ?? run.created_at),
        githubUrl: run.html_url,
        source: targetType,
      };

      if (run.status !== 'completed') {
        // Queued/in-progress: surface as running, no artifact download (AC-41).
        await this.repo.upsertRun({ ...base, status: 'running' });
        continue;
      }

      const storedStatus = storedStatuses.get(run.id);
      if (storedStatus && TERMINAL_STATUSES.has(storedStatus)) {
        // Already ingested to a terminal state — skip the download entirely
        // (AC-44, the R12 budget: at most one download per newly completed run).
        continue;
      }

      await this.ingestCompletedRun(github, repoRef, run.id, run.conclusion, base);
    }
  }

  /** Downloads and validates the result artifact for one completed run, and
   * derives the row's terminal status from it — never from the run's own
   * conclusion/exit code (AC-42, AC-43). */
  private async ingestCompletedRun(
    github: GitHubClient,
    repoRef: RepoRef,
    workflowRunId: string,
    conclusion: string | null,
    base: Omit<UpsertRunInput, 'status'>,
  ): Promise<void> {
    const artifactText = await github.downloadRunArtifactFile(
      repoRef,
      workflowRunId,
      ARTIFACT_NAME,
      ARTIFACT_FILE,
    );

    if (artifactText === null) {
      // No artifact was ever uploaded. Discriminate on the run's own
      // conclusion (read ONLY here, never once an artifact exists — see the
      // class doc comment): a `success` conclusion with no artifact means
      // the review job itself was skipped (fork PR's `fork-notice` job, or
      // this repo's bootstrap guard before `.devdigest/` is on the base
      // branch) rather than a genuine crash — report that honestly instead
      // of a misleading "failed".
      if (conclusion === 'success') {
        await this.repo.upsertRun({
          ...base,
          status: 'skipped',
          error: 'review skipped (fork PR, or DevDigest not yet on the base branch)',
          findingsCount: null,
          costUsd: null,
        });
        return;
      }
      await this.repo.upsertRun({
        ...base,
        status: 'failed',
        error: 'no result artifact',
        findingsCount: null,
        costUsd: null,
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(artifactText);
    } catch (err) {
      // Malformed content — never spread the raw text/parse failure into the
      // row; record a reason and leave metrics null (AC-43).
      await this.repo.upsertRun({
        ...base,
        status: 'failed',
        error: `result artifact is not valid JSON: ${errorMessage(err)}`,
        findingsCount: null,
        costUsd: null,
      });
      return;
    }

    const result = CiResultArtifact.safeParse(parsed);
    if (!result.success) {
      // Boundary check for untrusted, third-party-produced content — never
      // spread `parsed` itself into the row, only the zod failure reason.
      await this.repo.upsertRun({
        ...base,
        status: 'failed',
        error: result.error.message,
        findingsCount: null,
        costUsd: null,
      });
      return;
    }

    const artifact = result.data;
    const status: CiRun['status'] = artifact.findings_count === 0 ? 'no_findings' : 'succeeded';
    await this.repo.upsertRun({
      ...base,
      prNumber: artifact.pr_number ?? base.prNumber,
      status,
      findingsCount: artifact.findings_count,
      costUsd: artifact.cost_usd,
      agent: artifact.agent,
      // `duration_ms` is nullish in the artifact — convert defensively.
      durationS: artifact.duration_ms != null ? artifact.duration_ms / 1000 : null,
      error: null,
    });
  }
}
