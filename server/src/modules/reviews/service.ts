import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  PrIntentDetail,
  RunEventKind,
  RunTrace,
  SmartDiff,
} from '@devdigest/shared';
import {
  AppError,
  NotFoundError,
  ValidationError,
  ExternalServiceError,
} from '../../platform/errors.js';
import { RunLogger } from '../../platform/run-logger.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { BriefService } from './brief/index.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { IntentService } from './intent/service.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto, findingsFromLatestRunPerAgent } from './helpers.js';
import { buildSmartDiff } from './smart-diff/index.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  /**
   * Derived PR intent (L03), or `undefined` when none exists yet.
   *
   * Workspace-scoped: `pr_intent` has no `workspace_id` of its own, so this
   * MUST go through `getIntentDetail`'s join — a bare `prId` lookup (e.g.
   * `getIntent`) would be a cross-workspace read. The route returns 200+`null`
   * (never 404) for "no intent yet" — see routes.ts.
   */
  async getIntentDetail(workspaceId: string, prId: string): Promise<PrIntentDetail | undefined> {
    return this.repo.getIntentDetail(workspaceId, prId);
  }

  /**
   * Force a fresh intent derivation for one PR — `POST /pulls/:id/intent/recalculate`.
   *
   * Unlike every other read here this SPENDS TOKENS, so it is deliberately the
   * only manual trigger: no cache to short-circuit it (that is the point), a
   * tight per-route rate limit, and `IntentService.recalculate`'s per-PR
   * in-flight dedupe so concurrent callers share one model call.
   *
   * Failure is reported, not swallowed. D5 ("intent can never fail a review")
   * protects a *run* that has other work to finish; a manual call has none, and
   * returning the stale row would claim a re-derive that never happened.
   */
  async recalculateIntent(
    workspaceId: string,
    prId: string,
    logger?: Logger,
  ): Promise<PrIntentDetail> {
    if (!this.container.config.intentEnabled) {
      throw new ValidationError('Intent Layer is disabled (INTENT_ENABLED=false)');
    }
    // Workspace-scoped: this lookup is the ownership check for everything
    // below, since `pr_intent` carries no workspace_id of its own.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // No runIds → the logger publishes to no SSE stream (RunLogger.event loops
    // over them), so there is no fake agent_run row and nothing to subscribe
    // to; the evidence/confidence lines still reach the server's pino log.
    const runLog = new RunLogger(this.container.runBus, [], logger, { prId });
    try {
      await new IntentService(this.container).recalculate(workspaceId, pull, repo, runLog);
    } catch (err) {
      throw new ExternalServiceError(`Intent derivation failed: ${(err as Error).message}`);
    }

    const detail = await this.repo.getIntentDetail(workspaceId, prId);
    if (!detail) throw new ExternalServiceError('Intent was derived but could not be read back');
    return detail;
  }

  /**
   * Smart Diff for a PR — files grouped core/wiring/boilerplate and ordered
   * findings-first.
   *
   * Costs ZERO tokens by construction: the two reads below are the already
   * imported `pr_files` rows and the already persisted findings of the latest
   * review. `buildSmartDiff` is pure. Nothing on this path touches
   * `container.llm()` — see the acceptance criterion "no new model call in the
   * logs when viewing Smart Diff".
   *
   * Findings come from `findingsFromLatestRunPerAgent` — see that helper for
   * why neither "the newest review" nor "group by run id" nor "everything"
   * is the right set. The client renders its badges through the mirrored
   * helper in `lib/findings.ts`; the two must stay in step.
   */
  async smartDiffForPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const reviews = await this.repo.reviewsForPull(prId);
    const anchors = findingsFromLatestRunPerAgent(reviews).map((f) => ({
      file: f.file,
      start_line: f.startLine,
    }));

    // Persisted per-file summaries, keyed to the PR's CURRENT head sha. This
    // is the sole enforcement point for "never serve a summary whose sha
    // differs from the pull request's current head" (AC-38): the SQL
    // predicate in `getFileSummaries` already filters on `pull.headSha`, so a
    // PR whose head moved since the summary was written simply gets an empty
    // map here and every `pseudocode_summary` renders `null`. Do NOT add an
    // application-level sha comparison on top of this — the predicate is
    // what makes a stale summary unforgeable; a second check would only be
    // redundant, never stronger.
    const summaries = await new BriefService(this.container).getFileSummaries(
      prId,
      pull.headSha,
    );

    return buildSmartDiff(files, anchors, summaries);
  }
}
