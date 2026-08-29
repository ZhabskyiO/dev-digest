import { describe, it, expect } from "vitest";
import type { PrAgentEstimates } from "@devdigest/shared";
import { aggregateEstimate, estimateForAgent } from "./helpers";

function estimates(agents: PrAgentEstimates["agents"]): PrAgentEstimates {
  return { pr_id: "pr1", agents };
}

describe("aggregateEstimate", () => {
  it("returns the max duration and summed cost over four priced agents (AC-6)", () => {
    const est = estimates([
      { agent_id: "a", agent_name: "A", est_duration_ms: 8200, est_cost_usd: 0.06, runs_sampled: 5, last_summary: null },
      { agent_id: "b", agent_name: "B", est_duration_ms: 7400, est_cost_usd: 0.05, runs_sampled: 5, last_summary: null },
      { agent_id: "c", agent_name: "C", est_duration_ms: 6900, est_cost_usd: 0.04, runs_sampled: 5, last_summary: null },
      { agent_id: "d", agent_name: "D", est_duration_ms: 7100, est_cost_usd: 0.05, runs_sampled: 5, last_summary: null },
    ]);

    const result = aggregateEstimate(["a", "b", "c", "d"], est);

    expect(result.duration_ms).toBe(8200);
    expect(result.cost_usd).toBeCloseTo(0.2, 10);
    expect(result.incomplete).toBe(false);
  });

  it("excludes an estimate-less agent from both the max and the sum, and marks the result incomplete (AC-7, AC-8)", () => {
    const est = estimates([
      { agent_id: "a", agent_name: "A", est_duration_ms: 8200, est_cost_usd: 0.06, runs_sampled: 5, last_summary: null },
      { agent_id: "b", agent_name: "B", est_duration_ms: 20000, est_cost_usd: 5, runs_sampled: 0, last_summary: null },
    ]);
    // "b" has no history at all — not present in the estimates list.
    const withNoHistory = aggregateEstimate(["a", "no-history-agent"], est);
    expect(withNoHistory.duration_ms).toBe(8200);
    expect(withNoHistory.cost_usd).toBeCloseTo(0.06, 10);
    expect(withNoHistory.incomplete).toBe(true);

    // "b" is present but reports null on both fields (zero samples).
    const zeroSampleEstimates = estimates([
      { agent_id: "a", agent_name: "A", est_duration_ms: 8200, est_cost_usd: 0.06, runs_sampled: 5, last_summary: null },
      { agent_id: "b", agent_name: "B", est_duration_ms: null, est_cost_usd: null, runs_sampled: 0, last_summary: null },
    ]);
    const withZeroSamples = aggregateEstimate(["a", "b"], zeroSampleEstimates);
    expect(withZeroSamples.duration_ms).toBe(8200);
    expect(withZeroSamples.cost_usd).toBeCloseTo(0.06, 10);
    expect(withZeroSamples.incomplete).toBe(true);
  });

  it("returns nulls and incomplete:false for an empty selection", () => {
    const result = aggregateEstimate([], estimates([]));
    expect(result).toEqual({ duration_ms: null, cost_usd: null, incomplete: false });
  });

  it("marks incomplete when one field is null even if the other is present", () => {
    const est = estimates([
      { agent_id: "a", agent_name: "A", est_duration_ms: 5000, est_cost_usd: null, runs_sampled: 3, last_summary: null },
    ]);
    const result = aggregateEstimate(["a"], est);
    expect(result.duration_ms).toBe(5000);
    expect(result.cost_usd).toBeNull();
    expect(result.incomplete).toBe(true);
  });
});

describe("estimateForAgent", () => {
  it("finds the matching entry by agent_id", () => {
    const est = estimates([
      { agent_id: "a", agent_name: "A", est_duration_ms: 1000, est_cost_usd: 0.01, runs_sampled: 1, last_summary: "hi" },
    ]);
    expect(estimateForAgent("a", est)?.last_summary).toBe("hi");
  });

  it("returns undefined for an unknown agent id or undefined estimates", () => {
    expect(estimateForAgent("missing", estimates([]))).toBeUndefined();
    expect(estimateForAgent("missing", undefined)).toBeUndefined();
  });
});
