import type {
  AgentColumn,
  AgentColumnFinding,
  AgentRunEstimate,
  MultiAgentRun,
  MultiAgentRunStartResponse,
  PrAgentEstimates,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { AgentRow, AgentRunRow, FindingRow } from '../../db/rows.js';
import { buildLocationGroups, type GroupingRejection } from './grouping.js';
import { estimateForAgent, multiRunTotals, type RunForTotals } from './estimates.js';
import { ESTIMATE_RUN_WINDOW } from './constants.js';

/**
 * The `{review, findings}` shape `reviewsWithFindingsForRunIds` resolves to,
 * derived from the container method's own return type rather than importing
 * `ReviewRow` from `modules/reviews/repository.js` directly — keeps this
 * module's only real coupling to the reviews module the `container.reviewRepo`
 * / `container.reviews` facades it already goes through.
 */
type ReviewWithFindings = Awaited<
  ReturnType<Container['reviewRepo']['reviewsWithFindingsForRunIds']>
>[number];

/**
 * Multi-Agent Review (L07) — application layer. Owns no table itself: every
 * DB access goes through `container.reviewRepo` / `container.agentsRepo`
 * (the "one file owns this table" rule stays with
 * `modules/reviews/repository/{run,review}.repo.ts`), and the actual review
 * execution is reached via `container.reviews.runReview` rather than
 * importing `modules/reviews/*` internals directly.
 */
export class MultiAgentService {
  constructor(private container: Container) {}

  // ===========================================================================
  // Start a multi-agent run
  // ===========================================================================

  /**
   * Resolve the PR workspace-scoped first (404 if it belongs to another
   * workspace or doesn't exist — AC-20), then resolve EVERY requested agent
   * via `container.agentsRepo.getById` and throw on the first miss BEFORE
   * creating anything (AC-21: a foreign/missing agent id must leave no
   * `multi_agent_runs`/`agent_runs` row behind). Only once every agent is
   * confirmed does this create the `multi_agent_runs` row and fan the run out
   * through `container.reviews.runReview`, returning immediately with one
   * run id per agent — before any review completes (AC-24).
   *
   * If `runReview` itself throws (e.g. the repo was deleted between the
   * checks above and the call, or a DB failure mid its `createAgentRun`
   * loop), the just-created `multi_agent_runs` row is deleted before
   * rethrowing — otherwise it survives as an orphan with zero linked
   * `agent_runs`, and `latest()` would then surface it as the PR's newest
   * multi-run (`columns: []`, `status: 'complete'`), masking whatever real
   * run preceded it.
   */
  async start(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Parameters<Container['reviews']['runReview']>[3],
  ): Promise<MultiAgentRunStartResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const agents: AgentRow[] = [];
    for (const agentId of agentIds) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      agents.push(agent);
    }

    const multiRunId = await this.container.reviewRepo.createMultiAgentRun({
      workspaceId,
      prId,
    });

    try {
      const { runs } = await this.container.reviews.runReview(workspaceId, prId, agents, logger, {
        multiRunId,
      });
      return { multi_run_id: multiRunId, pr_id: prId, runs };
    } catch (err) {
      await this.container.reviewRepo.deleteMultiAgentRun(workspaceId, multiRunId);
      throw err;
    }
  }

  // ===========================================================================
  // Latest multi-agent run — columns + conflicts + totals, one read
  // ===========================================================================

  /**
   * `undefined` from `latestMultiRunForPull` becomes `null` (AC-19: a PR that
   * has never had a multi-agent run answers 200 with an empty body, not 404).
   * A PR that doesn't resolve in this workspace at all is a genuine 404
   * (AC-20) — checked first via `getPull`, which is what lets those two cases
   * stay distinguishable even though both routes through
   * `latestMultiRunForPull` alone would otherwise look identical
   * (`undefined` either way).
   *
   * A multi-run with ZERO linked `agent_runs` is also treated as absent
   * (`null`), not rendered as an empty `columns: []` / `status: 'complete'`
   * run — that shape only occurs when `start()`'s rollback failed to catch a
   * `runReview` throw (or a pre-rollback row survives from before that fix),
   * and surfacing it would mask whatever real multi-run preceded it.
   */
  async latest(workspaceId: string, prId: string): Promise<MultiAgentRun | null> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const multiRun = await this.container.reviewRepo.latestMultiRunForPull(workspaceId, prId);
    if (!multiRun) return null;

    const runRows = await this.container.reviewRepo.runsForMultiRun(multiRun.id);
    if (runRows.length === 0) return null;

    const runIds = runRows.map(({ run }) => run.id);
    const reviewsByRunId = new Map<string, ReviewWithFindings>();
    for (const entry of await this.container.reviewRepo.reviewsWithFindingsForRunIds(runIds)) {
      if (entry.review.runId) reviewsByRunId.set(entry.review.runId, entry);
    }

    const columns: AgentColumn[] = runRows.map(({ run, agentName }) =>
      buildColumn(run, agentName, reviewsByRunId.get(run.id)),
    );

    const status: MultiAgentRun['status'] = columns.some(
      (c) => c.status === 'queued' || c.status === 'running',
    )
      ? 'running'
      : 'complete';

    const totals = multiRunTotals(runRows.map(({ run }) => toRunForTotals(run)));

    // Keyed by `run_id`, not `agent_id`: `grouping.ts` merges/attributes by
    // run identity so that two columns whose agent was since deleted (both
    // surfacing `agent_id: ''`) don't collapse into one pseudo-agent. Keying
    // here by the stable `run.id` (rather than gating on `run.agentId` being
    // present) also stops a deleted agent's rejections from being silently
    // dropped — every run gets an entry regardless of whether its agent
    // still exists.
    const rejections = new Map<string, GroupingRejection[]>();
    for (const { run } of runRows) {
      rejections.set(run.id, run.groundingRejected ?? []);
    }
    const conflicts = buildLocationGroups({ columns, rejections });

    return {
      id: multiRun.id,
      pr_id: multiRun.prId,
      pr_number: pull.number,
      ran_at: multiRun.ranAt.toISOString(),
      agent_count: columns.length,
      status,
      total_duration_ms: totals.total_duration_ms,
      total_cost_usd: totals.total_cost_usd,
      shared_error: sharedError(columns),
      columns,
      conflicts,
    };
  }

  // ===========================================================================
  // Pre-run estimates — every agent in the workspace
  // ===========================================================================

  async estimates(workspaceId: string, prId: string): Promise<PrAgentEstimates> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const agents = await this.container.agentsRepo.list(workspaceId);
    const agentIds = agents.map((a) => a.id);

    const [stats, summaries] = await Promise.all([
      this.container.reviewRepo.recentCompletedRunStats(workspaceId, agentIds, ESTIMATE_RUN_WINDOW),
      this.container.reviewRepo.latestCompletedSummaryForPull(workspaceId, prId, agentIds),
    ]);

    const result: AgentRunEstimate[] = agents.map((agent) => {
      const samples = stats.get(agent.id) ?? [];
      const estimate = estimateForAgent(samples);
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        est_duration_ms: estimate.est_duration_ms,
        est_cost_usd: estimate.est_cost_usd,
        runs_sampled: estimate.runs_sampled,
        last_summary: summaries.get(agent.id) ?? null,
      };
    });

    return { pr_id: prId, agents: result };
  }
}

// ---------------------------------------------------------------------------
// Pure mapping helpers (no I/O — DB rows already fetched by the caller)
// ---------------------------------------------------------------------------

function toRunForTotals(run: AgentRunRow): RunForTotals {
  return {
    ranAt: run.ranAt,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    status: run.status ?? 'running',
  };
}

function toAgentColumnFinding(row: FindingRow): AgentColumnFinding {
  return {
    id: row.id,
    severity: row.severity as AgentColumnFinding['severity'],
    category: row.category,
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    confidence: row.confidence,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    kind: row.kind ?? null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
  } satisfies AgentColumnFinding;
}

function buildColumn(
  run: AgentRunRow,
  agentName: string | null,
  reviewData: ReviewWithFindings | undefined,
): AgentColumn {
  return {
    run_id: run.id,
    agent_id: run.agentId ?? '',
    agent_name: agentName ?? 'Unknown agent',
    provider: run.provider,
    model: run.model,
    status: (run.status ?? 'running') as AgentColumn['status'],
    verdict: reviewData?.review.verdict ?? null,
    score: run.score,
    summary: reviewData?.review.summary ?? null,
    duration_ms: run.durationMs,
    cost_usd: run.costUsd,
    error: run.error,
    findings: reviewData ? reviewData.findings.map(toAgentColumnFinding) : [],
  };
}

/**
 * AC-38: a shared (multi-run-level) error is reported ONLY when every column
 * failed AND every one of them recorded the exact same error string — a
 * genuinely shared pre-work failure (e.g. the PR's repo failed to resolve
 * before any agent even started), not several agents independently failing
 * for different reasons.
 */
function sharedError(columns: AgentColumn[]): string | null {
  if (columns.length === 0) return null;
  if (!columns.every((c) => c.status === 'failed')) return null;
  const [first, ...rest] = columns.map((c) => c.error);
  if (first == null) return null;
  return rest.every((e) => e === first) ? first : null;
}
