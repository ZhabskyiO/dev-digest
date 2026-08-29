import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, PrIntentDetail, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, and persists the
 * observability rows `agent_runs` + `run_traces` (one trace doc per run).
 * Workspace scoping is enforced via the PR (which carries workspace_id).
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull/intent). This class
 * composes them so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;
export type RepoRow = typeof t.repos.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';
import type { IntentRow, UpsertIntentInput } from './repository/pull.repo.js';
export type { IntentRow, UpsertIntentInput };
import type { AgentRunRow } from '../../db/rows.js';
import type { GroundingRejection, MultiAgentRunRow } from './repository/run.repo.js';
export type { GroundingRejection, MultiAgentRunRow };

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  /** Repo by `owner/name` — the local review path's entry point (no PR row). */
  getRepoByFullName(
    workspaceId: string,
    fullName: string,
  ): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepoByFullName(this.db, workspaceId, fullName);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  getPrCommits(prId: string): Promise<(typeof t.prCommits.$inferSelect)[]> {
    return pullRepo.getPrCommits(this.db, prId);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    return reviewRepo.insertReview(this.db, values);
  }

  insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(this.db, reviewId, findings);
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  /** Reviews for a set of `agent_runs` ids, each with its findings — the
   *  multi-agent view's per-column data source. */
  reviewsWithFindingsForRunIds(
    runIds: string[],
  ): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsWithFindingsForRunIds(this.db, runIds);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, runId);
  }

  /** On boot: any run still 'running' is orphaned (its process died / restarted),
   *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- intent -------------------------------------------------------------

  upsertIntent(prId: string, input: UpsertIntentInput): Promise<void> {
    return pullRepo.upsertIntent(this.db, prId, input);
  }

  /**
   * Full persisted row (incl. `headSha` for cache-hit comparison).
   *
   * NOT workspace-scoped — `prId` alone is trusted. Only call this with a
   * `prId` that has already been resolved through a workspace-scoped lookup
   * (e.g. the `PullRow` returned by `getPull`). Do not expose this to a route
   * handler taking an untrusted `prId` from the request; use
   * `getIntentDetail` for that.
   */
  getIntent(prId: string): Promise<IntentRow | undefined> {
    return pullRepo.getIntent(this.db, prId);
  }

  /** Workspace-scoped — the only safe lookup for `GET /pulls/:id/intent`. */
  getIntentDetail(workspaceId: string, prId: string): Promise<PrIntentDetail | undefined> {
    return pullRepo.getIntentDetail(this.db, workspaceId, prId);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Links this run to the multi-agent run that spawned it, if any. */
    multiRunId?: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  completeAgentRun(
    runId: string,
    values: {
      status: 'done' | 'failed' | 'cancelled';
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      findingsCount: number;
      grounding: string;
      /** Review score (0-100); null on failed/cancelled runs. */
      score?: number | null;
      /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
      blockers?: number | null;
      /** Failure reason (status='failed') / cancellation note. Null clears it. */
      error?: string | null;
      /**
       * Run cost in USD. Null when the model has no known price or the run did
       * not complete — the UI renders `—`, never `$0.00`.
       */
      costUsd?: number | null;
      /** Findings that failed grounding — "did not flag" notes (AC-50). */
      groundingRejected?: GroundingRejection[] | null;
    },
  ): Promise<void> {
    return runRepo.completeAgentRun(this.db, runId, values);
  }

  // ---- observability: multi_agent_runs -----------------------------------

  /** Create a `multi_agent_runs` row; returns its id. */
  createMultiAgentRun(values: { workspaceId: string; prId: string }): Promise<string> {
    return runRepo.createMultiAgentRun(this.db, values);
  }

  /** Delete a `multi_agent_runs` row (compensating rollback if the fan-out
   *  that should follow creating it throws before returning). Workspace-scoped. */
  deleteMultiAgentRun(workspaceId: string, multiRunId: string): Promise<boolean> {
    return runRepo.deleteMultiAgentRun(this.db, workspaceId, multiRunId);
  }

  /** Most recent multi-agent run for a PR, workspace-scoped (undefined for a
   *  foreign workspace). */
  latestMultiRunForPull(
    workspaceId: string,
    prId: string,
  ): Promise<MultiAgentRunRow | undefined> {
    return runRepo.latestMultiRunForPull(this.db, workspaceId, prId);
  }

  /** Every `agent_runs` row spawned by one multi-agent run, joined to its
   *  agent's current name. */
  runsForMultiRun(
    multiRunId: string,
  ): Promise<{ run: AgentRunRow; agentName: string | null }[]> {
    return runRepo.runsForMultiRun(this.db, multiRunId);
  }

  /** Per-agent last `limit` completed runs' duration/cost, workspace-wide. */
  recentCompletedRunStats(
    workspaceId: string,
    agentIds: string[],
    limit: number,
  ): Promise<Map<string, { durationMs: number | null; costUsd: number | null }[]>> {
    return runRepo.recentCompletedRunStats(this.db, workspaceId, agentIds, limit);
  }

  /** Per-agent most recent completed run's review summary on this PR. */
  latestCompletedSummaryForPull(
    workspaceId: string,
    prId: string,
    agentIds: string[],
  ): Promise<Map<string, string | null>> {
    return runRepo.latestCompletedSummaryForPull(this.db, workspaceId, prId, agentIds);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string): Promise<void> {
    return pullRepo.markReviewed(this.db, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, runId);
  }
}
