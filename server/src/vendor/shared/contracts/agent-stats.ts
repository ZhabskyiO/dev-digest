import { z } from 'zod';

/**
 * Aggregate run stats for one agent — feeds the AgentCard summary row and the
 * agent-editor Stats tab's KPI tiles (TOTAL RUNS / AVG COST / AVG DURATION /
 * ACCEPT RATE). Computed entirely from `agent_runs` (+ a join to `reviews` for
 * accept rate) — no new tables.
 */
export const AgentRunStats = z.object({
  runs: z.number().int(),
  /**
   * % of this agent's runs that produced a review with verdict 'approve',
   * among runs that produced ANY review (verdict is set) — not a share of
   * all runs, since a failed/cancelled run has no review to judge. `null`
   * when the agent has no reviewed runs yet, so the UI can render "—"
   * instead of a misleading 0%.
   */
  accept_rate: z.number().nullable(),
  /**
   * Average cost across runs with a known cost. `null` when no run has a
   * cost yet — nulls are excluded from the average, not treated as $0 (a
   * failed run has no billed cost, it isn't a free one).
   */
  avg_cost_usd: z.number().nullable(),
  /**
   * `avg_cost_usd` minus the average cost over the immediately preceding
   * window of equal length (e.g. days 31-60 when `days=30`) — the signed
   * delta the Stats tab tile renders next to the average. `null` when `days`
   * was omitted, or either window has no priced runs to compare.
   */
  avg_cost_usd_delta: z.number().nullable(),
  /** Average duration (ms) across runs with a recorded duration. `null` when none yet. */
  avg_duration_ms: z.number().nullable(),
  /**
   * Daily run counts, oldest → newest, over the requested `days` window —
   * feeds the TOTAL RUNS tile's sparkline. Empty when `days` was omitted (an
   * unbounded all-time daily series isn't computed).
   */
  trend: z.array(z.number().int()),
});
export type AgentRunStats = z.infer<typeof AgentRunStats>;
