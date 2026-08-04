/**
 * Severity ordering shared by every surface that lists findings — the PR
 * detail page's findings panel and the PR list's findings hover card. Lives in
 * `lib` rather than inside one page's `_components/` so neither has to reach
 * into the other's folder.
 */
import type { FindingRecord } from "@devdigest/shared";

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
