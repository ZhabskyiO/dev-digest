/* Pure aggregation helpers for AgentPicker — kept dependency-free so they can
   be unit-tested in isolation from React/next-intl (helpers.test.ts). */
import type { AgentRunEstimate, PrAgentEstimates } from "@devdigest/shared";

/** Looks up one agent's historical run estimate by id. Returns `undefined`
 *  when the workspace has no `AgentRunEstimate` entry for that agent at all
 *  (brand-new agent, or `estimates` not loaded yet) — distinct from an entry
 *  whose fields are individually `null`. */
export function estimateForAgent(
  agentId: string,
  estimates: PrAgentEstimates | undefined,
): AgentRunEstimate | undefined {
  return estimates?.agents.find((a) => a.agent_id === agentId);
}

export interface AggregateEstimate {
  /** Parallel fan-out finishes when the slowest checked agent does — the
   *  MAX of the checked agents' estimated durations, over entries that have
   *  a value. `null` when none of the checked agents has a duration
   *  estimate. */
  duration_ms: number | null;
  /** Every checked agent's call is billed independently — the SUM of the
   *  checked agents' estimated costs, over entries that have a value. `null`
   *  when none of the checked agents has a cost estimate. */
  cost_usd: number | null;
  /** `true` when at least one checked agent is missing an estimate (no
   *  history at all, or missing either field) — the aggregate above is then
   *  a LOWER BOUND, not the true total, and must be labelled as such. */
  incomplete: boolean;
}

/**
 * Aggregates the CHECKED agents' estimates for the run-preview UI, mirroring
 * the server-side rule 1:1 (`server/src/modules/multi-agent/estimates.ts`'s
 * `aggregateEstimate`): duration = max over present values, cost = sum over
 * present values, both computed only over entries that HAVE a value — an
 * estimate-less agent contributes to neither and only flips `incomplete`.
 * NEVER folds a missing value in as `0` — that would silently understate the
 * true cost/duration once the agent actually runs.
 */
export function aggregateEstimate(
  selected: string[],
  estimates: PrAgentEstimates | undefined,
): AggregateEstimate {
  let duration_ms: number | null = null;
  let cost_usd: number | null = null;
  let incomplete = false;

  for (const agentId of selected) {
    const est = estimateForAgent(agentId, estimates);
    if (!est || est.est_duration_ms == null || est.est_cost_usd == null) {
      incomplete = true;
    }
    if (est?.est_duration_ms != null) {
      duration_ms = duration_ms == null ? est.est_duration_ms : Math.max(duration_ms, est.est_duration_ms);
    }
    if (est?.est_cost_usd != null) {
      cost_usd = cost_usd == null ? est.est_cost_usd : cost_usd + est.est_cost_usd;
    }
  }

  return { duration_ms, cost_usd, incomplete };
}

/** Bare seconds (no unit) for interpolating into a "≈ {duration}s" catalogue
 *  string — `null` in, `null` out, so the caller can fall back to the
 *  catalogue's dash string instead of formatting a missing value. */
export function toSeconds(ms: number | null): number | null {
  return ms == null ? null : Math.round((ms / 100)) / 10;
}
