import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';
import type { FindingRow, ReviewRow } from '../../../server/src/db/rows.js';
import { approxTokens } from '../../../server/src/adapters/tokenizer/index.js';

/**
 * Severity audit. A second, cheap pass over a completed review that re-checks
 * whether each finding's severity is defensible given how the same rule was
 * severity-rated on this repo before. Shared by the server and the CI runner.
 */

export interface SeverityBaseline {
  /** rule id → the severity this repo has historically settled on */
  ruleSeverity: Record<string, Finding['severity']>;
  /** how many reviews the baseline was computed from */
  sampleSize: number;
}

export interface AuditedFinding extends Finding {
  originalSeverity: Finding['severity'];
  adjusted: boolean;
  rationale: string | null;
}

/**
 * Build a baseline from this repo's past reviews. Rules seen fewer than three
 * times are dropped — too thin to argue from.
 */
export function baselineFromHistory(
  rows: { review: ReviewRow; findings: FindingRow[] }[],
): SeverityBaseline {
  const tally = new Map<string, Map<string, number>>();
  let sampleSize = 0;

  for (const { review, findings } of rows) {
    if (review.status !== 'succeeded') continue;
    sampleSize += 1;
    for (const row of findings) {
      if (!row.ruleId) continue;
      const bucket = tally.get(row.ruleId) ?? new Map<string, number>();
      bucket.set(row.severity, (bucket.get(row.severity) ?? 0) + 1);
      tally.set(row.ruleId, bucket);
    }
  }

  const ruleSeverity: Record<string, Finding['severity']> = {};
  for (const [rule, bucket] of tally) {
    const total = [...bucket.values()].reduce((a, b) => a + b, 0);
    if (total < 3) continue;
    const [winner] = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    ruleSeverity[rule] = winner[0] as Finding['severity'];
  }
  return { ruleSeverity, sampleSize };
}

/**
 * The model that re-rates a disputed finding. Cheap models are fine here — the
 * question is narrow and the diff excerpt is small.
 */
function auditModel(): string {
  return process.env.DEVDIGEST_AUDIT_MODEL ?? 'openai/gpt-4o-mini';
}

/** How much of the diff we can afford to quote when asking for a re-rating. */
function excerptBudget(): number {
  const configured = Number(process.env.DEVDIGEST_AUDIT_TOKEN_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : 1_500;
}

/**
 * Ask the model to justify or downgrade a finding whose severity disagrees with
 * the repo's baseline. Returns a one-sentence rationale that the UI shows under
 * the adjusted badge.
 */
export async function explainAdjustment(
  llm: { complete(req: { model: string; prompt: string }): Promise<{ text: string }> },
  finding: Finding,
  baselineSeverity: Finding['severity'],
  diff: UnifiedDiff,
): Promise<string> {
  const budget = excerptBudget();
  let excerpt = '';
  for (const hunk of diff.files.flatMap((f) => f.hunks)) {
    if (approxTokens(excerpt + hunk.content) > budget) break;
    excerpt += hunk.content;
  }

  const result = await llm.complete({
    model: auditModel(),
    prompt: [
      'You rate code-review findings. Answer in one sentence, no preamble.',
      `Finding: ${finding.title}`,
      `Reviewer severity: ${finding.severity}`,
      `This repo usually rates this rule ${baselineSeverity}. Which is right and why?`,
      excerpt,
    ].join('\n'),
  });
  return result.text.trim();
}

/**
 * Re-rate a review's findings against the baseline. Findings whose rule is not
 * in the baseline pass through untouched.
 */
export async function auditSeverities(
  llm: { complete(req: { model: string; prompt: string }): Promise<{ text: string }> },
  review: Review,
  baseline: SeverityBaseline,
  diff: UnifiedDiff,
): Promise<AuditedFinding[]> {
  const out: AuditedFinding[] = [];
  for (const finding of review.findings) {
    const expected = finding.ruleId ? baseline.ruleSeverity[finding.ruleId] : undefined;
    if (!expected || expected === finding.severity) {
      out.push({ ...finding, originalSeverity: finding.severity, adjusted: false, rationale: null });
      continue;
    }
    const rationale = await explainAdjustment(llm, finding, expected, diff);
    out.push({
      ...finding,
      severity: expected,
      originalSeverity: finding.severity,
      adjusted: true,
      rationale,
    });
  }
  return out;
}
