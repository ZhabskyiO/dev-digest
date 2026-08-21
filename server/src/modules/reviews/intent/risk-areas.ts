import type { RiskArea } from '@devdigest/shared';

/**
 * Pure grounding for derived `RiskArea`s — PURE, no I/O.
 *
 * PURE — no imports from `db/`, `adapters/`, `platform/container`, `fs`, or
 * `node:fs`. Plain functions over plain data only, matching the rest of this
 * module (`confidence.ts`, `evidence.ts`).
 *
 * `RiskArea.file_refs` and `RiskArea.explanation` are model output and MUST
 * NOT be trusted at face value before persistence/render:
 *
 * - a `file_refs` entry naming a path outside the PR's actual changed-file set
 *   is an unverifiable claim — drop the reference, but keep the risk area
 *   (and its `label`) unchanged. A risk area is a "look here" hint, not a
 *   finding, so an unresolvable ref is not grounds to reject the whole area.
 * - an `explanation` has no length limit enforced by the model; truncate it
 *   defensively rather than reject the risk area for being verbose.
 *
 * This is deliberately NOT the same code path as `groundFindings()`
 * (reviewer-core) — that grounds *findings* against real diff lines and can
 * drop a whole finding; risk areas are display-only hints and are never
 * dropped for an unverifiable ref, only trimmed.
 */

/** Hard cap on `explanation` length, ellipsis included. */
const MAX_EXPLANATION_CHARS = 280;
const ELLIPSIS = '…';

/**
 * Truncate to exactly `MAX_EXPLANATION_CHARS`, with the ellipsis as the last
 * character when truncation happens — i.e. `MAX_EXPLANATION_CHARS - 1` chars
 * of content plus the ellipsis, not `MAX_EXPLANATION_CHARS` chars followed by
 * an appended ellipsis (which would overshoot the cap by one).
 */
function truncateExplanation(explanation: string): string {
  if (explanation.length <= MAX_EXPLANATION_CHARS) return explanation;
  return explanation.slice(0, MAX_EXPLANATION_CHARS - 1) + ELLIPSIS;
}

/**
 * Ground a single risk area's `file_refs` against the PR's changed-file set
 * and cap its `explanation` length. Never drops the risk area itself.
 */
function groundRiskArea(area: RiskArea, changedPaths: ReadonlySet<string>): RiskArea {
  const grounded: RiskArea = { ...area };

  if (area.file_refs != null) {
    grounded.file_refs = area.file_refs.filter((ref) => changedPaths.has(ref.path));
  }

  if (area.explanation != null) {
    grounded.explanation = truncateExplanation(area.explanation);
  }

  return grounded;
}

/**
 * Ground every risk area in a derived list against the PR's actual
 * changed-file set. Pure, deterministic, order-preserving; never changes the
 * list's length.
 */
export function groundRiskAreas(
  areas: RiskArea[],
  changedPaths: readonly string[],
): RiskArea[] {
  const changedSet = new Set(changedPaths);
  return areas.map((area) => groundRiskArea(area, changedSet));
}
