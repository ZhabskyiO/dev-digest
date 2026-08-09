/**
 * Severity ordering shared by every surface that lists findings — the PR
 * detail page's findings panel and the PR list's findings hover card. Lives in
 * `lib` rather than inside one page's `_components/` so neither has to reach
 * into the other's folder.
 */
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** Weight for a severity outside the table — sorts after every known one. */
const UNKNOWN_SEVERITY_ORDER = 9;

/** Copy of `findings` ordered CRITICAL → WARNING → SUGGESTION → INFO. */
export function sortBySeverity<T extends Pick<FindingRecord, "severity">>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? UNKNOWN_SEVERITY_ORDER) -
      (SEVERITY_ORDER[b.severity] ?? UNKNOWN_SEVERITY_ORDER),
  );
}

/**
 * The findings that describe a PR's CURRENT review state: for each agent, that
 * agent's most recent review's findings, unioned.
 *
 * MIRRORS `findingsFromLatestRunPerAgent` in the server's
 * `modules/reviews/helpers.ts`, and must keep mirroring it. Smart Diff renders
 * its per-file badges from this while the `finding_lines` those badges jump to
 * come from the server applying the same rule — diverge and a badge's count
 * disagrees with the lines behind it. That helper's doc comment carries the
 * full reasoning (short version: `reviews[0]` alone is whichever agent finished
 * last, every agent has its own run id, and taking everything double-counts
 * re-runs).
 *
 * `reviews` MUST be newest-first, which is what `usePrReviews` returns.
 */
export function findingsFromLatestRunPerAgent(
  reviews: readonly Pick<ReviewRecord, "id" | "agent_id" | "findings">[] | undefined,
): FindingRecord[] {
  const seen = new Set<string>();
  const out: FindingRecord[] = [];
  for (const review of reviews ?? []) {
    const key = review.agent_id ?? `review:${review.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...review.findings);
  }
  return out;
}
