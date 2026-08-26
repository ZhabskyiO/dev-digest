import type { EvalCaseOutcome, EvalExpectation, EvalRun, Finding } from '@devdigest/shared';

/**
 * Eval scoring — fully deterministic code, NO model in the loop.
 *
 * A finding satisfies an expectation when the file matches exactly and the
 * line ranges intersect — the same matching rule the citation-grounding gate
 * uses against diff hunks, applied here against the expectation's range.
 *
 * Metrics per batch (one run of the agent over its whole case set):
 *  - recall              = matched `must_find` cases / total `must_find` cases
 *  - precision           = share of emitted findings that are NOT noise, where
 *                          noise = findings that hit a `must_not_flag` target
 *                          (this is where dismissed-born cases do their work)
 *  - citation_accuracy   = findings that survived the grounding gate / all
 *                          findings the model emitted (kept + dropped)
 */

/** Inclusive intersection of two line ranges (order-insensitive). */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

export function matchesExpectation(
  exp: Pick<EvalExpectation, 'file' | 'start_line' | 'end_line'>,
  f: Finding,
): boolean {
  return f.file === exp.file && rangesOverlap(exp.start_line, exp.end_line, f.start_line, f.end_line);
}

export interface CaseScore {
  pass: boolean;
  /** Findings that satisfied a `must_find` expectation. */
  matched: number;
  /** Findings that hit a `must_not_flag` target (counted against precision). */
  noise: number;
}

/** Score one case. A malformed (unparseable) expectation can never pass. */
export function scoreCase(exp: EvalExpectation | null, kept: Finding[]): CaseScore {
  if (!exp) return { pass: false, matched: 0, noise: 0 };
  const hits = kept.filter((f) => matchesExpectation(exp, f)).length;
  if (exp.type === 'must_find') return { pass: hits > 0, matched: hits, noise: 0 };
  return { pass: hits === 0, matched: 0, noise: hits };
}

/** Aggregate a batch of executed cases into the shared `EvalRun` shape. */
export function scoreBatch(outcomes: EvalCaseOutcome[]): EvalRun {
  let mustFindTotal = 0;
  let mustFindMatched = 0;
  let keptTotal = 0;
  let droppedTotal = 0;
  let noiseTotal = 0;
  let passed = 0;
  let durationMs = 0;
  let costUsd: number | null = 0;
  const perTrace: EvalRun['per_trace'] = [];

  for (const o of outcomes) {
    const score = scoreCase(o.expectation, o.kept);
    if (o.expectation?.type === 'must_find') {
      mustFindTotal += 1;
      if (score.pass) mustFindMatched += 1;
    }
    noiseTotal += score.noise;
    keptTotal += o.kept.length;
    droppedTotal += o.dropped_count;
    if (score.pass) passed += 1;
    durationMs += o.duration_ms;
    costUsd = costUsd == null || o.cost_usd == null ? null : costUsd + o.cost_usd;
    perTrace.push({
      name: o.name,
      pass: score.pass,
      expected: o.expectation,
      actual: o.kept.map((f) => ({
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        severity: f.severity,
        title: f.title,
      })),
    });
  }

  const preGate = keptTotal + droppedTotal;
  return {
    recall: mustFindTotal === 0 ? 1 : mustFindMatched / mustFindTotal,
    precision: keptTotal === 0 ? 1 : (keptTotal - noiseTotal) / keptTotal,
    citation_accuracy: preGate === 0 ? 1 : keptTotal / preGate,
    traces_passed: passed,
    traces_total: outcomes.length,
    duration_ms: durationMs,
    cost_usd: costUsd,
    per_trace: perTrace,
  };
}
