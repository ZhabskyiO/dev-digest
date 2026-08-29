/**
 * Multi-Agent Review (L07) — pure estimate/total aggregations.
 *
 * Pure functions only: no `container`, no `db`, no I/O of any kind. Callers
 * (the multi-agent repository/service, T9/T10) fetch the raw run rows and
 * pass plain data in; these functions never reach for a data source
 * themselves.
 *
 * `null` is load-bearing throughout, never `0`: a run that failed or hasn't
 * finished has `costUsd: null` by design (`run-executor.ts` writes it
 * explicitly rather than `0`), and a value with no basis (zero samples, an
 * all-null window) must render "—" downstream, not "$0.00" or "0ms". Folding
 * a missing value in as zero is exactly the bug AC-7/AC-9/AC-22 forbid.
 */

/** Statuses `AgentColumn.status` can hold that will never change again. */
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface RunSample {
  durationMs: number | null;
  costUsd: number | null;
}

export interface AgentEstimate {
  est_duration_ms: number | null;
  est_cost_usd: number | null;
  runs_sampled: number;
}

/**
 * Arithmetic mean over the recent-run window (`ESTIMATE_RUN_WINDOW` samples,
 * caller-selected), each field averaged independently over its own non-null
 * values (Rec-2: reconciles AC-9's "most recent run" phrasing with D-3's
 * windowed aggregate). `runs_sampled` is the number of runs in the window
 * passed in, regardless of how many of those carried a value for either
 * field — it describes the sampling basis, not a per-field count.
 */
export function estimateForAgent(samples: RunSample[]): AgentEstimate {
  const durations = samples
    .map((s) => s.durationMs)
    .filter((v): v is number => v != null);
  const costs = samples.map((s) => s.costUsd).filter((v): v is number => v != null);

  return {
    est_duration_ms:
      durations.length > 0
        ? // rounded: AgentRunEstimate.est_duration_ms is z.number().int(), and the
          // response serializer rejects a fractional mean with a 500
          Math.round(durations.reduce((sum, v) => sum + v, 0) / durations.length)
        : null,
    est_cost_usd:
      costs.length > 0 ? costs.reduce((sum, v) => sum + v, 0) / costs.length : null,
    runs_sampled: samples.length,
  };
}

export interface EstimateInput {
  est_duration_ms: number | null;
  est_cost_usd: number | null;
}

export interface AggregateEstimate {
  duration_ms: number | null;
  cost_usd: number | null;
  incomplete: boolean;
}

/**
 * Combine several agents' individual estimates into one pre-run aggregate:
 * duration is the `max` of the checked agents' estimates (the run finishes
 * when the slowest agent does), cost is the `sum` (every checked agent bills
 * independently). An agent with no basis for one or both fields (`null`) is
 * excluded from that field's max/sum rather than counted as zero, and
 * `incomplete` is set whenever any input entry is missing either field — the
 * aggregate is then a lower bound, not a precise total (AC-6, AC-8).
 */
export function aggregateEstimate(estimates: EstimateInput[]): AggregateEstimate {
  const durations = estimates
    .map((e) => e.est_duration_ms)
    .filter((v): v is number => v != null);
  const costs = estimates.map((e) => e.est_cost_usd).filter((v): v is number => v != null);
  const incomplete = estimates.some(
    (e) => e.est_duration_ms == null || e.est_cost_usd == null,
  );

  return {
    duration_ms: durations.length > 0 ? Math.max(...durations) : null,
    cost_usd: costs.length > 0 ? costs.reduce((sum, v) => sum + v, 0) : null,
    incomplete,
  };
}

export interface RunForTotals {
  ranAt: Date;
  durationMs: number | null;
  costUsd: number | null;
  status: string;
}

export interface MultiRunTotals {
  total_duration_ms: number | null;
  total_cost_usd: number | null;
}

/**
 * Aggregate a multi-run's spawned agent runs into wall-clock duration + total
 * cost (AC-22). Duration is the span from the earliest run's start to the
 * latest run's completion (`ranAt + durationMs`) — never the sum of the
 * individual durations, since the runs execute concurrently (R12/D-2) — and
 * stays `null` while any run in the group is still `queued`/`running`, since
 * the span has no final end yet. Cost is the sum of every TERMINAL run's
 * cost, but turns `null` (not a smaller number) the moment any terminal run
 * recorded a `null` cost — an unpriced run makes the total genuinely unknown,
 * it does not shrink it.
 */
export function multiRunTotals(runs: RunForTotals[]): MultiRunTotals {
  const anyNonTerminal = runs.some((r) => !isTerminalStatus(r.status));

  let total_duration_ms: number | null = null;
  if (!anyNonTerminal && runs.length > 0) {
    const starts = runs.map((r) => r.ranAt.getTime());
    const ends = runs
      .filter((r): r is RunForTotals & { durationMs: number } => r.durationMs != null)
      .map((r) => r.ranAt.getTime() + r.durationMs);
    if (ends.length > 0) {
      total_duration_ms = Math.max(...ends) - Math.min(...starts);
    }
  }

  const terminalRuns = runs.filter((r) => isTerminalStatus(r.status));
  const anyTerminalMissingCost = terminalRuns.some((r) => r.costUsd == null);

  let total_cost_usd: number | null = null;
  if (terminalRuns.length > 0 && !anyTerminalMissingCost) {
    total_cost_usd = terminalRuns.reduce((sum, r) => sum + (r.costUsd as number), 0);
  }

  return { total_duration_ms, total_cost_usd };
}
