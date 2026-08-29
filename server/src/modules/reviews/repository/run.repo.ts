import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';
import type { AgentRunRow } from '../../../db/rows.js';

/** A finding this run's model proposed but which failed the grounding gate. */
export type GroundingRejection = {
  file: string;
  start_line: number;
  end_line: number;
  title: string;
  reason: string;
};

export type MultiAgentRunRow = typeof t.multiAgentRuns.$inferSelect;

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
    cost_usd: run.costUsd,
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Links this run to the multi-agent run that spawned it, if any. */
    multiRunId?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
      multiRunId: values.multiRunId ?? null,
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

export async function completeAgentRun(
  db: Db,
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
    /**
     * Findings this run's model proposed but which failed the grounding gate —
     * surfaced as "did not flag" notes in the multi-agent disagreement view
     * (AC-50). Null clears it (e.g. a failed/cancelled run).
     */
    groundingRejected?: GroundingRejection[] | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
      costUsd: values.costUsd ?? null,
      groundingRejected: values.groundingRejected ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}

// ---- observability: multi_agent_runs --------------------------------------

/** Create a `multi_agent_runs` row; returns its id. Individual `agent_runs`
 *  spawned for it must be created separately (each carrying `multiRunId`). */
export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/**
 * Most recent multi-agent run for a PR.
 *
 * Workspace-scoped via a join on `pull_requests` — `multi_agent_runs` also
 * carries its own `workspace_id` column, but the join is kept as the
 * authoritative check anyway (same defence-in-depth precedent as
 * `pull.repo.ts::getIntentDetail`'s doc comment for `pr_intent`): a caller
 * must never be able to read another workspace's multi-run by guessing/
 * enumerating a `prId`. Returns `undefined`, never throws, when the PR
 * belongs to a different workspace or doesn't exist.
 */
export async function latestMultiRunForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select({ multiRun: t.multiAgentRuns })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.multiAgentRuns.prId, t.pullRequests.id))
    .where(
      and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)),
    )
    .orderBy(desc(t.multiAgentRuns.ranAt))
    .limit(1);
  return row?.multiRun;
}

/**
 * Delete a `multi_agent_runs` row. Workspace-scoped so a caller can never
 * delete another workspace's row. Used as a compensating rollback when
 * `start()` creates the row but the fan-out that should follow it
 * (`container.reviews.runReview`) throws before returning — `agent_runs.
 * multi_run_id` is `ON DELETE SET NULL` (`db/schema/runs.ts`), so any
 * `agent_runs` rows already linked at the moment of the throw keep their own
 * history and simply lose the (now-gone) link, rather than being deleted
 * themselves. Returns `true` if a row was actually deleted.
 */
export async function deleteMultiAgentRun(
  db: Db,
  workspaceId: string,
  multiRunId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.id, multiRunId), eq(t.multiAgentRuns.workspaceId, workspaceId)))
    .returning({ id: t.multiAgentRuns.id });
  return rows.length > 0;
}

/** Every `agent_runs` row spawned by one multi-agent run, oldest first, each
 *  joined to its agent's current name (null if the agent was since deleted). */
export async function runsForMultiRun(
  db: Db,
  multiRunId: string,
): Promise<{ run: AgentRunRow; agentName: string | null }[]> {
  return db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(eq(t.agentRuns.multiRunId, multiRunId))
    .orderBy(t.agentRuns.ranAt);
}

/**
 * Per-agent history for the "estimate before you run" preview (AC-22-adjacent):
 * the last `limit` COMPLETED (`status='done'`) runs' `durationMs`/`costUsd`,
 * workspace-wide (D-3 — not scoped to one PR, since a fresh PR has no prior
 * runs of its own to sample from).
 *
 * ONE query via a `row_number() OVER (PARTITION BY agent_id ORDER BY ran_at
 * DESC)` window, not one query per agent — drizzle-orm 0.38.3's `pg-core` has
 * no per-partition `LIMIT` combinator, so the window has to be raw `sql`
 * (same precedent as `modules/repo-intel/repository.ts`'s `resolveReferences`/
 * `modules/project-context/repository.ts`'s `usedByAgentCounts`). Every
 * `agentId` in the input list gets a map entry (`[]` default, filled in from
 * the query) so the returned shape matches the previous per-agent-query
 * implementation exactly. NEVER interpolate a `Date` into this template —
 * only `workspaceId`/`agentIds`/`limit` (all strings/numbers) are used.
 */
export async function recentCompletedRunStats(
  db: Db,
  workspaceId: string,
  agentIds: string[],
  limit: number,
): Promise<Map<string, { durationMs: number | null; costUsd: number | null }[]>> {
  const result = new Map<string, { durationMs: number | null; costUsd: number | null }[]>(
    agentIds.map((id) => [id, []]),
  );
  if (agentIds.length === 0) return result;

  const idList = sql.join(
    agentIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{
    agent_id: string;
    duration_ms: number | null;
    cost_usd: number | null;
  }>(sql`
    SELECT agent_id, duration_ms, cost_usd
    FROM (
      SELECT
        agent_id,
        duration_ms,
        cost_usd,
        row_number() OVER (PARTITION BY agent_id ORDER BY ran_at DESC) AS rn
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}
        AND status = 'done'
        AND agent_id IN (${idList})
    ) ranked
    WHERE rn <= ${limit}
    ORDER BY agent_id, rn
  `);

  for (const row of rows) {
    result.get(row.agent_id)?.push({ durationMs: row.duration_ms, costUsd: row.cost_usd });
  }
  return result;
}

/**
 * Per-agent most recent COMPLETED run's review summary on ONE specific PR
 * (used to preview "what did this agent say last time on this PR", distinct
 * from `recentCompletedRunStats`'s workspace-wide duration/cost sampling).
 * `null` for an agent with no completed run on this PR, even if it has
 * completed runs elsewhere in the workspace.
 */
export async function latestCompletedSummaryForPull(
  db: Db,
  workspaceId: string,
  prId: string,
  agentIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(agentIds.map((id) => [id, null]));
  if (agentIds.length === 0) return result;
  const rows = await db
    .select({ agentId: t.agentRuns.agentId, summary: t.reviews.summary })
    .from(t.agentRuns)
    .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'done'),
        inArray(t.agentRuns.agentId, agentIds),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt));
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.agentId || seen.has(row.agentId)) continue;
    seen.add(row.agentId);
    result.set(row.agentId, row.summary ?? null);
  }
  return result;
}
