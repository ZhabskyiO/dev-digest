import type { Container } from '../../platform/container.js';
import type {
  CiFailOn,
  Finding,
  LocalReviewRequest,
  LocalReviewResult,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import { IMPLEMENTED_LOCAL_REVIEW_MODES } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentRow } from '../../db/rows.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ReviewRepository } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { localTaskLine } from './helpers.js';
import {
  buildCallersDigest,
  buildRepoMapDigest,
  buildRankNote,
  resolveAgentSkills,
  type StepLog,
} from './prompt-context.js';

/**
 * Local review — run the reviewer over a diff that has NO pull request behind
 * it (the `devdigest review --mode working` CLI, before `git push`).
 *
 * This is the same review, earlier. It reuses, unchanged:
 *   - the agent row (system prompt, model, provider, strategy, gate, repo-intel
 *     toggle) resolved exactly as `ReviewService.resolveTargets` resolves it,
 *   - the agent's linked+enabled skills (`resolveAgentSkills`),
 *   - the repo-intel prompt enrichment (`prompt-context.ts`),
 *   - `reviewPullRequest` from `@devdigest/reviewer-core` — prompt assembly,
 *     injection guard, structured output, and the mandatory citation-grounding
 *     gate, so a local finding is grounded by the same rule a PR finding is,
 *   - `countBlockers` for the deterministic gate signal the CLI exits on.
 *
 * What it deliberately does NOT do, and why:
 *   - no persistence. `reviews`, `findings`, `agent_runs`, and `run_traces` all
 *     hang off a `pr_id`; a working tree has none, and inventing a synthetic PR
 *     row to hold throwaway pre-push runs would pollute every PR-scoped query
 *     and rollup in the studio.
 *   - no SSE. There is no run id to subscribe to; the CLI is a request/response
 *     client, and progress events go to the request log.
 *   - no PR intent. Intent is derived from PR title/body/linked issues, none of
 *     which exist yet.
 */
export class LocalReviewService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  async review(
    workspaceId: string,
    req: LocalReviewRequest,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<LocalReviewResult> {
    if (!IMPLEMENTED_LOCAL_REVIEW_MODES.includes(req.mode)) {
      // The contract knows `staged` and `branch`; the server does not run them
      // yet. Fail loudly and specifically rather than silently reviewing the
      // diff under the wrong framing.
      throw new AppError(
        'mode_not_implemented',
        `Local review mode '${req.mode}' is not implemented yet. Supported: ${IMPLEMENTED_LOCAL_REVIEW_MODES.join(', ')}.`,
        400,
      );
    }

    const degraded: string[] = [];
    const log: StepLog = {
      info: (msg) => logger?.info({ localReview: req.mode }, msg),
    };

    // ---- Diff ---------------------------------------------------------------
    // Parsed here, not on the client: the grounding gate indexes the SAME
    // UnifiedDiff the prompt was built from, so the parse must be the server's.
    const diff: UnifiedDiff = parseUnifiedDiff(req.diff);
    if (diff.files.length === 0) {
      throw new ValidationError(
        'The diff contains no reviewable file changes (unparseable, or binary/mode changes only).',
      );
    }

    // ---- Agent --------------------------------------------------------------
    const agent = await this.resolveAgent(workspaceId, req.agentId);
    const failOn: CiFailOn = req.failOn ?? (agent.ciFailOn as CiFailOn);

    // ---- Prompt context (same enrichment a PR run gets) ---------------------
    const repoIntelOn = agent.repoIntel !== false;
    let repoId: string | undefined;
    if (req.repo) {
      const repoRow = await this.repo.getRepoByFullName(workspaceId, req.repo);
      if (repoRow) repoId = repoRow.id;
      else degraded.push(`repo '${req.repo}' is not imported — reviewing the diff without repo context`);
    } else {
      degraded.push('no repo given — reviewing the diff without repo context');
    }
    if (repoId && !repoIntelOn) {
      degraded.push(`repo intel is disabled for agent '${agent.name}'`);
    }

    const enrich = repoId !== undefined && repoIntelOn;
    const callers = enrich ? await buildCallersDigest(this.container, repoId!, diff, log) : undefined;
    const repoMap = enrich ? await buildRepoMapDigest(this.container, repoId!, log) : undefined;
    const rankNote = enrich ? await buildRankNote(this.container, repoId!, diff, log) : '';
    if (enrich && !repoMap && !callers) {
      degraded.push('repo is imported but not indexed — no repo map or caller context in the prompt');
    }

    // No run id here, so no `run_skills` attribution row — that table records
    // what a PERSISTED run used, and this run is never persisted.
    const skills = await resolveAgentSkills(this.container, agent.id);
    log.info(`skills: ${skills.ids.length}/${skills.linkedCount} linked skill(s) enabled and attached`);

    // ---- Engine -------------------------------------------------------------
    const llm = await this.container.llm(agent.provider as Provider);
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy ?? REVIEW_STRATEGY,
      ...(callers ? { callers } : {}),
      ...(repoMap ? { repoMap } : {}),
      ...(skills.bodies.length ? { skills: skills.bodies } : {}),
      task: localTaskLine(req.mode, req.label),
      sessionId: `local:${req.mode}:${agent.name}`,
      onEvent: (e) => logger?.info({ kind: e.kind }, e.msg),
    });

    const findings = sortBySeverity(outcome.review.findings);
    const blockers = countBlockers(findings, failOn);

    logger?.info(
      {
        agent: agent.name,
        mode: req.mode,
        files: diff.files.length,
        findings: findings.length,
        blockers,
        grounding: outcome.grounding,
      },
      `local review: ${findings.length} finding(s), ${blockers} blocking`,
    );

    return {
      mode: req.mode,
      agent: {
        id: agent.id,
        name: agent.name,
        provider: agent.provider as Provider,
        model: agent.model,
      },
      files: diff.files.length,
      verdict: outcome.review.verdict,
      summary: outcome.review.summary,
      score: outcome.review.score,
      grounding: outcome.grounding,
      counts: {
        critical: findings.filter((f) => f.severity === 'CRITICAL').length,
        warning: findings.filter((f) => f.severity === 'WARNING').length,
        suggestion: findings.filter((f) => f.severity === 'SUGGESTION').length,
      },
      fail_on: failOn,
      blockers,
      blocking: blockers > 0,
      findings,
      degraded,
    };
  }

  /**
   * The agent to run. An explicit id resolves like any PR run; without one we
   * only auto-pick when the choice is unambiguous — a CLI that silently picked
   * "some enabled agent" would give different results on different machines.
   */
  private async resolveAgent(workspaceId: string, agentId?: string): Promise<AgentRow> {
    if (agentId) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      if (!agent.enabled) throw new ValidationError(`Agent '${agent.name}' is disabled.`);
      return agent;
    }
    const enabled = await this.container.agentsRepo.listEnabled(workspaceId);
    const only = enabled[0];
    if (!only) throw new ValidationError('No enabled agent to review with. Enable one in Agents.');
    if (enabled.length > 1) {
      throw new ValidationError(
        `Multiple enabled agents — pass agentId. Available: ${enabled
          .map((a) => `${a.name} (${a.id})`)
          .join(', ')}.`,
      );
    }
    return only;
  }
}

/** CRITICAL → WARNING → SUGGESTION; stable within a severity. */
function sortBySeverity(findings: Finding[]): Finding[] {
  const rank: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
  return [...findings].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}
