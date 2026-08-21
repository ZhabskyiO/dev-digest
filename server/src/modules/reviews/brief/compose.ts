/**
 * Pure composition for the PR Brief's read-time fields — Review Focus and the
 * verdict rollup. Side-effect free: no container, no DB, no `this`, no clock —
 * the same contract `modules/reviews/helpers.ts` states for itself. These
 * functions turn already-persisted, already-grounded data (findings, reviews,
 * diff patches) into the wire shapes `@devdigest/shared`'s `contracts/pr-brief.ts`
 * defines; they never touch a model.
 */
import type { Finding, ReviewFocusEntry, BriefVerdictSummary, Verdict } from '@devdigest/shared';

/** Max Review Focus entries surfaced on the brief (AC-23). Overflow is silent. */
const MAX_REVIEW_FOCUS = 6;

/** Cap on a Review Focus entry's `reason` (derived from the finding's own title). */
const MAX_REASON_LENGTH = 140;

/** Severity rank for sorting Review Focus — lower sorts first (blockers first). */
const SEVERITY_RANK: Record<Finding['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Verdict rank for `aggregateVerdict` — higher wins a disagreement (AC-28). */
const VERDICT_RANK: Record<Verdict, number> = {
  approve: 0,
  comment: 1,
  request_changes: 2,
};

/** Collapse a finding's title to a single line and cap it at 140 characters. */
function toReason(title: string): string {
  const oneLine = title.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_REASON_LENGTH
    ? `${oneLine.slice(0, MAX_REASON_LENGTH - 1)}…`
    : oneLine;
}

/**
 * Compose the brief's Review Focus list from already-grounded findings.
 *
 * `changedLines` maps a file (as it appears in the PR's diff) to the set of
 * head-side line numbers that diff touches — see `changedLinesFromPatches`
 * below. AC-24 requires checking BOTH halves of the `file:line` anchor: a
 * finding whose `file` is not a key of `changedLines` is dropped, and so is a
 * finding whose `file` IS a key but whose `start_line` is not a member of that
 * file's line set. Checking file membership alone is the defect this
 * criterion exists to catch (e.g. `a.ts:99` must be dropped even though
 * `a.ts` itself is touched by the diff).
 *
 * Reasons are composed from the finding's own `title` — NEVER model prose —
 * which is what keeps Review Focus grounded (no fresh, unverified text from
 * an LLM is ever surfaced here).
 */
export function composeReviewFocus(
  findings: readonly Finding[],
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
): ReviewFocusEntry[] {
  const survivors: ReviewFocusEntry[] = [];
  for (const finding of findings) {
    const lines = changedLines.get(finding.file);
    if (!lines || !lines.has(finding.start_line)) continue;
    survivors.push({
      file: finding.file,
      line: finding.start_line,
      reason: toReason(finding.title),
      severity: finding.severity,
      finding_id: finding.id,
    });
  }

  survivors.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) return byFile;
    return a.line - b.line;
  });

  return survivors.slice(0, MAX_REVIEW_FOCUS);
}

/**
 * One agent's latest run, as `aggregateVerdict` needs it: enough to compute
 * the PR-level verdict/score, plus the findings that survived grounding on
 * that run so blockers can be counted from the same list the total findings
 * count comes from (AC-48) — never from a denormalized per-run column like
 * `agent_runs.blockers`, which is per-run agent-gate policy and may
 * legitimately disagree with a straight count of CRITICAL findings.
 */
export interface LatestAgentRun {
  verdict: Verdict;
  /** Null when the run carries no score (e.g. failed before scoring). */
  score: number | null;
  findings: readonly Pick<Finding, 'severity'>[];
}

/**
 * Aggregate the PR-level verdict summary over the latest run per agent.
 *
 * - `null` when there is no latest run at all (AC-30 — no completed run ⇒ the
 *   verdict block is omitted entirely).
 * - `verdict` is the most severe of `request_changes > comment > approve`
 *   (AC-28): one agent voting `request_changes` overrides another's `approve`.
 * - `findings` is the total finding count across every run in the set.
 * - `blockers` is the count of CRITICAL-severity findings in that same set
 *   (AC-48) — computed here, never read off a per-run `blockers` column.
 * - `score` is the LOWEST non-null score among the runs (AC-47, deliberately
 *   pessimistic so one agent's clean pass cannot mask another's bad result) —
 *   never the mean, never the best; `null` when no run carries a score.
 */
export function aggregateVerdict(latestPerAgent: readonly LatestAgentRun[]): BriefVerdictSummary | null {
  if (latestPerAgent.length === 0) return null;

  let verdict: Verdict = 'approve';
  let findings = 0;
  let blockers = 0;
  let lowestScore: number | null = null;

  for (const run of latestPerAgent) {
    if (VERDICT_RANK[run.verdict] > VERDICT_RANK[verdict]) {
      verdict = run.verdict;
    }
    findings += run.findings.length;
    for (const finding of run.findings) {
      if (finding.severity === 'CRITICAL') blockers += 1;
    }
    if (run.score !== null && (lowestScore === null || run.score < lowestScore)) {
      lowestScore = run.score;
    }
  }

  return { verdict, findings, blockers, score: lowestScore };
}

/**
 * Parse `@@ -a,b +c,d @@` unified-diff hunk headers to build the head-side
 * changed-line set `composeReviewFocus` needs for AC-24.
 *
 * KNOWN DUPLICATION, DECLARED ON PURPOSE: `modules/blast/helpers.ts::changedLineRanges`
 * computes a structurally similar thing (base- or head-side line RANGES) for
 * the blast module. Importing it here would be a `modules/brief → modules/blast`
 * cross-module edge, exactly the class of edge `dependency-cruiser` already
 * warns on — this module only needs `modules/reviews/*` internals. The two
 * implementations coexist deliberately; promoting one to a shared pure util is
 * a follow-up, not this task.
 */
export function changedLinesFromPatches(
  files: readonly { path: string; patch: string | null }[],
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

  for (const file of files) {
    if (!file.patch) continue;
    let lines = result.get(file.path);
    header.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = header.exec(file.patch)) !== null) {
      const rawStart = match[1];
      const rawCount = match[2];
      if (rawStart === undefined) continue;
      const start = Number(rawStart);
      const count = rawCount === undefined ? 1 : Number(rawCount);
      if (count === 0) continue; // pure deletion on the head side — nothing to anchor a finding to
      if (!lines) {
        lines = new Set<number>();
        result.set(file.path, lines);
      }
      for (let line = start; line < start + count; line += 1) {
        lines.add(line);
      }
    }
  }

  return result;
}
