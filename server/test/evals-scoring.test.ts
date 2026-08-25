/**
 * L07 — eval pipeline scoring + pure helpers. Code-only scoring (no model):
 * a finding counts when the file matches and the line ranges intersect.
 */
import { describe, it, expect } from 'vitest';
import type { EvalCaseOutcome, Finding } from '@devdigest/shared';
import { rangesOverlap, matchesExpectation, scoreCase, scoreBatch } from '../src/modules/evals/scoring.js';
import {
  slugifyCaseName,
  buildDiffFragment,
  decisionOf,
  expectationFromFinding,
  parseExpectation,
  groupRunsIntoBatches,
} from '../src/modules/evals/helpers.js';
import type { EvalRunRow } from '../src/modules/evals/repository.js';
import type { FindingRow } from '../src/db/rows.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded key',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    ...over,
  };
}

const MUST_FIND = {
  type: 'must_find' as const,
  file: 'src/config.ts',
  start_line: 10,
  end_line: 14,
};
const MUST_NOT_FLAG = {
  type: 'must_not_flag' as const,
  file: 'src/utils.ts',
  start_line: 5,
  end_line: 9,
};

function outcome(over: Partial<EvalCaseOutcome>): EvalCaseOutcome {
  return {
    case_id: 'c1',
    name: 'case',
    expectation: MUST_FIND,
    kept: [],
    dropped_count: 0,
    duration_ms: 100,
    cost_usd: 0.01,
    ...over,
  };
}

describe('rangesOverlap / matchesExpectation', () => {
  it('detects intersecting and disjoint ranges (order-insensitive)', () => {
    expect(rangesOverlap(10, 14, 12, 12)).toBe(true);
    expect(rangesOverlap(14, 10, 12, 12)).toBe(true); // reversed bounds still work
    expect(rangesOverlap(10, 14, 15, 20)).toBe(false);
    expect(rangesOverlap(10, 14, 14, 20)).toBe(true); // inclusive boundary
  });

  it('requires the exact same file', () => {
    expect(matchesExpectation(MUST_FIND, finding())).toBe(true);
    expect(matchesExpectation(MUST_FIND, finding({ file: 'src/other.ts' }))).toBe(false);
    expect(matchesExpectation(MUST_FIND, finding({ start_line: 99, end_line: 99 }))).toBe(false);
  });
});

describe('scoreCase', () => {
  it('must_find passes only when a finding hits the target', () => {
    expect(scoreCase(MUST_FIND, [finding()])).toEqual({ pass: true, matched: 1, noise: 0 });
    expect(scoreCase(MUST_FIND, [])).toEqual({ pass: false, matched: 0, noise: 0 });
    expect(scoreCase(MUST_FIND, [finding({ file: 'x.ts' })])).toEqual({
      pass: false,
      matched: 0,
      noise: 0,
    });
  });

  it('must_not_flag passes only when NOTHING hits the forbidden spot', () => {
    expect(scoreCase(MUST_NOT_FLAG, [])).toEqual({ pass: true, matched: 0, noise: 0 });
    // a finding elsewhere in the same diff is fine
    expect(scoreCase(MUST_NOT_FLAG, [finding({ file: 'src/utils.ts', start_line: 50, end_line: 50 })]))
      .toEqual({ pass: true, matched: 0, noise: 0 });
    expect(scoreCase(MUST_NOT_FLAG, [finding({ file: 'src/utils.ts', start_line: 6, end_line: 7 })]))
      .toEqual({ pass: false, matched: 0, noise: 1 });
  });

  it('a malformed expectation can never pass', () => {
    expect(scoreCase(null, [finding()]).pass).toBe(false);
  });
});

describe('scoreBatch', () => {
  it('computes recall / precision / citation_accuracy from the definitions', () => {
    const r = scoreBatch([
      // must_find hit: 1 kept finding on target
      outcome({ case_id: 'a', name: 'hit', kept: [finding()], dropped_count: 1 }),
      // must_find miss
      outcome({ case_id: 'b', name: 'miss', kept: [] }),
      // must_not_flag violated: 1 noise finding
      outcome({
        case_id: 'c',
        name: 'noisy',
        expectation: MUST_NOT_FLAG,
        kept: [finding({ file: 'src/utils.ts', start_line: 5, end_line: 5 })],
      }),
    ]);
    expect(r.recall).toBeCloseTo(1 / 2); // 1 of 2 must_find matched
    expect(r.precision).toBeCloseTo(1 / 2); // 2 kept findings, 1 is noise
    expect(r.citation_accuracy).toBeCloseTo(2 / 3); // 2 kept of 3 emitted (1 dropped)
    expect(r.traces_passed).toBe(1);
    expect(r.traces_total).toBe(3);
    expect(r.duration_ms).toBe(300);
    expect(r.cost_usd).toBeCloseTo(0.03);
    expect(r.per_trace.map((t) => t.pass)).toEqual([true, false, false]);
  });

  it('per_trace carries the full actual-finding shape (file/lines/severity/title) — kills the ObjectLiteral/ArrowFunction mutants on the actual mapping', () => {
    const f = finding({ title: 'Hardcoded key', severity: 'CRITICAL' });
    const r = scoreBatch([outcome({ case_id: 'a', name: 'hit', kept: [f] })]);
    // Deep, exact assertion: a mutant that maps `actual` to `undefined` or `{}`
    // (survivors at scoring.ts:79 in the 2026-08-24 Stryker run) must die here.
    expect(r.per_trace[0]!.actual).toEqual([
      {
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        severity: 'CRITICAL',
        title: 'Hardcoded key',
      },
    ]);
    expect(r.per_trace[0]!.expected).toEqual(MUST_FIND);
  });

  it('degenerate batches score 1.0, and one unknown cost nulls the total', () => {
    const r = scoreBatch([outcome({ expectation: MUST_NOT_FLAG, kept: [], cost_usd: null })]);
    expect(r.recall).toBe(1); // no must_find cases
    expect(r.precision).toBe(1); // no findings at all
    expect(r.citation_accuracy).toBe(1); // nothing emitted
    expect(r.cost_usd).toBeNull();
  });
});

describe('case-creation helpers', () => {
  it('slugifyCaseName kebab-cases and bounds the title', () => {
    expect(slugifyCaseName('Hardcoded Stripe secret key!')).toBe('hardcoded-stripe-secret-key');
    expect(slugifyCaseName('***')).toBe('eval-case');
  });

  it('buildDiffFragment produces a parseable single-file unified diff header', () => {
    const frag = buildDiffFragment('src/config.ts', '@@ -10,6 +10,7 @@\n+  key: "sk_live_x",');
    expect(frag).toContain('diff --git a/src/config.ts b/src/config.ts');
    expect(frag).toContain('--- a/src/config.ts');
    expect(frag).toContain('+++ b/src/config.ts');
    expect(frag.endsWith('\n')).toBe(true);
  });

  it('decisionOf: accepted→accepted, dismissed→dismissed, undecided→null, both→latest', () => {
    const t1 = new Date('2026-08-01');
    const t2 = new Date('2026-08-02');
    expect(decisionOf({ acceptedAt: t1, dismissedAt: null })).toBe('accepted');
    expect(decisionOf({ acceptedAt: null, dismissedAt: t1 })).toBe('dismissed');
    expect(decisionOf({ acceptedAt: null, dismissedAt: null })).toBeNull();
    expect(decisionOf({ acceptedAt: t1, dismissedAt: t2 })).toBe('dismissed');
    expect(decisionOf({ acceptedAt: t2, dismissedAt: t1 })).toBe('accepted');
  });

  it('expectationFromFinding maps decision → expectation type and round-trips parse', () => {
    const row = {
      id: 'f9',
      file: 'src/a.ts',
      startLine: 3,
      endLine: 5,
      severity: 'WARNING',
      category: 'bug',
      title: 'Missing retry',
    } as unknown as FindingRow;
    const accepted = expectationFromFinding(row, 'accepted');
    expect(accepted.type).toBe('must_find');
    const dismissed = expectationFromFinding(row, 'dismissed');
    expect(dismissed.type).toBe('must_not_flag');
    expect(parseExpectation(accepted)).toEqual(accepted); // valid against the contract
    expect(parseExpectation({ nope: true })).toBeNull();
  });
});

describe('groupRunsIntoBatches', () => {
  function runRow(over: Partial<EvalRunRow>): { run: EvalRunRow } {
    return {
      run: {
        id: Math.random().toString(36).slice(2),
        caseId: 'c1',
        ranAt: new Date('2026-08-24T10:00:00Z'),
        actualOutput: { batch_id: 'b1', agent_id: 'a1', agent_version: 3, model: 'm', provider: 'openai', findings: [] },
        pass: true,
        recall: 0.8,
        precision: 0.9,
        citationAccuracy: 0.95,
        durationMs: 100,
        costUsd: 0.01,
        ...over,
      } as EvalRunRow,
    };
  }

  it('folds per-case rows into one batch and aggregates pass/duration/cost', () => {
    const batches = groupRunsIntoBatches([
      runRow({}),
      runRow({ pass: false, costUsd: 0.02 }),
      runRow({
        ranAt: new Date('2026-08-23T10:00:00Z'),
        actualOutput: { batch_id: 'b0', agent_id: 'a1', agent_version: 2, model: 'm', provider: 'openai' },
      }),
    ]);
    expect(batches.map((b) => b.batch_id)).toEqual(['b1', 'b0']); // newest-first preserved
    expect(batches[0]).toMatchObject({
      agent_version: 3,
      passed: 1,
      total: 2,
      duration_ms: 200,
      recall: 0.8,
    });
    expect(batches[0]!.cost_usd).toBeCloseTo(0.03);
  });

  it('skips rows without a batch stamp instead of inventing a batch', () => {
    expect(groupRunsIntoBatches([runRow({ actualOutput: null })])).toEqual([]);
  });

  it("excludes single-case runs (scope:'case') from the comparable batch history", () => {
    const single = runRow({
      actualOutput: { batch_id: 'b9', agent_id: 'a1', scope: 'case', model: 'm', provider: 'openai' },
    });
    expect(groupRunsIntoBatches([single])).toEqual([]);
    // a full-set batch alongside it still comes through
    expect(groupRunsIntoBatches([single, runRow({})]).map((b) => b.batch_id)).toEqual(['b1']);
  });
});
