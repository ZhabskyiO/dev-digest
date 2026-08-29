import { describe, expect, it } from 'vitest';
import {
  aggregateEstimate,
  estimateForAgent,
  multiRunTotals,
} from '../src/modules/multi-agent/estimates.js';

describe('estimateForAgent', () => {
  it('reports null estimates and zero runs_sampled for an agent with no history (AC-7)', () => {
    const result = estimateForAgent([]);
    expect(result).toEqual({
      est_duration_ms: null,
      est_cost_usd: null,
      runs_sampled: 0,
    });
  });

  it('averages non-null durations/costs independently, never folding a null in as zero (AC-7)', () => {
    // Distinctive fixture numbers (777x) so this can never pass by
    // coincidence with MockLLMProvider's fixed 0.001/duration-0 fixtures
    // (server/insights/gotchas.md 2026-08-21).
    const result = estimateForAgent([
      { durationMs: 7770, costUsd: 7.77 },
      { durationMs: 7772, costUsd: null }, // failed run: cost null, duration still recorded
      { durationMs: null, costUsd: 7.71 },
    ]);
    expect(result.est_duration_ms).toBe((7770 + 7772) / 2);
    expect(result.est_cost_usd).toBeCloseTo((7.77 + 7.71) / 2);
    expect(result.runs_sampled).toBe(3);
  });

  it('rounds a fractional duration mean to an integer — AgentRunEstimate.est_duration_ms is z.number().int() and the response serializer 500s on a float', () => {
    const result = estimateForAgent([
      { durationMs: 7771, costUsd: null },
      { durationMs: 7772, costUsd: null },
    ]);
    expect(result.est_duration_ms).toBe(7772); // Math.round(7771.5), not 7771.5
    expect(Number.isInteger(result.est_duration_ms)).toBe(true);
  });
});

describe('aggregateEstimate', () => {
  it('aggregates duration as max and cost as sum (AC-6)', () => {
    const result = aggregateEstimate([
      { est_duration_ms: 8200, est_cost_usd: 0.06 },
      { est_duration_ms: 7400, est_cost_usd: 0.05 },
      { est_duration_ms: 6900, est_cost_usd: 0.04 },
      { est_duration_ms: 7100, est_cost_usd: 0.05 },
    ]);
    expect(result.duration_ms).toBe(8200);
    expect(result.cost_usd).toBeCloseTo(0.2);
    expect(result.incomplete).toBe(false);
  });

  it('excludes a no-history agent from max/sum entirely, contributing nothing (AC-7)', () => {
    const noHistory = estimateForAgent([]);
    const result = aggregateEstimate([
      { est_duration_ms: 8200, est_cost_usd: 0.06 },
      noHistory,
    ]);
    expect(result.duration_ms).toBe(8200);
    expect(result.cost_usd).toBeCloseTo(0.06);
    expect(result.incomplete).toBe(true);
  });

  it('marks incomplete true when one entry is missing an estimate (AC-8)', () => {
    const result = aggregateEstimate([
      { est_duration_ms: 8200, est_cost_usd: 0.06 },
      { est_duration_ms: null, est_cost_usd: null },
    ]);
    expect(result.incomplete).toBe(true);
    // still excluded rather than zeroed
    expect(result.duration_ms).toBe(8200);
    expect(result.cost_usd).toBeCloseTo(0.06);
  });

  it('returns null for both fields when no entry has any value', () => {
    const result = aggregateEstimate([{ est_duration_ms: null, est_cost_usd: null }]);
    expect(result.duration_ms).toBeNull();
    expect(result.cost_usd).toBeNull();
    expect(result.incomplete).toBe(true);
  });
});

describe('multiRunTotals', () => {
  it('returns total_cost_usd null (not a smaller number) when a terminal run has null cost, duration is span not sum (AC-22)', () => {
    const base = new Date('2026-08-27T10:00:00.000Z').getTime();
    const runs = [
      { ranAt: new Date(base), durationMs: 7777, costUsd: 7.77, status: 'done' },
      // this run started later but ran long, finishing last
      { ranAt: new Date(base + 1000), durationMs: 20000, costUsd: null, status: 'failed' },
      { ranAt: new Date(base + 2000), durationMs: 3000, costUsd: 4.44, status: 'done' },
    ];

    const result = multiRunTotals(runs);

    expect(result.total_cost_usd).toBeNull();

    // span = latest completion (base + 1000 + 20000 = base + 21000) - earliest start (base)
    expect(result.total_duration_ms).toBe(21000);
    // must not equal the naive sum of durations (7777 + 20000 + 3000 = 30777)
    expect(result.total_duration_ms).not.toBe(7777 + 20000 + 3000);
  });

  it('sums cost and computes the wall-clock span when every run is terminal and priced', () => {
    const base = new Date('2026-08-27T10:00:00.000Z').getTime();
    const runs = [
      { ranAt: new Date(base), durationMs: 5000, costUsd: 1.0, status: 'done' },
      { ranAt: new Date(base + 500), durationMs: 4000, costUsd: 2.0, status: 'done' },
    ];

    const result = multiRunTotals(runs);

    expect(result.total_cost_usd).toBeCloseTo(3.0);
    // latest end = max(base+5000, base+500+4000=base+4500) = base+5000
    // earliest start = base
    expect(result.total_duration_ms).toBe(5000);
  });

  it('returns total_duration_ms null while any run is non-terminal', () => {
    const base = new Date('2026-08-27T10:00:00.000Z').getTime();
    const runs = [
      { ranAt: new Date(base), durationMs: 5000, costUsd: 1.0, status: 'done' },
      { ranAt: new Date(base + 500), durationMs: null, costUsd: null, status: 'running' },
    ];

    const result = multiRunTotals(runs);

    expect(result.total_duration_ms).toBeNull();
  });
});
