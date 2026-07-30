import type { FindingRecord } from "@devdigest/shared";
import {
  POPOVER_GAP,
  POPOVER_MARGIN,
  POPOVER_WIDTH,
  type SeverityBreakdown,
  type TallySeverity,
} from "./constants";

/** All-zero tally — what an unreviewed PR (or a run with no findings) reports. */
export const EMPTY_BREAKDOWN: SeverityBreakdown = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };

export function totalFindings(counts: SeverityBreakdown): number {
  return counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
}

function isTallySeverity(s: string): s is TallySeverity {
  return s === "CRITICAL" || s === "WARNING" || s === "SUGGESTION";
}

/**
 * Tally findings the client already holds. The PR list gets its counts from the
 * server instead (`PrMeta.findings_by_severity`, aggregated in SQL); this is for
 * the surfaces that already have the findings in memory — the run timeline and
 * the review-run accordion headers.
 */
// Takes `{ severity: string }`, not the narrower contract enum: `findings.severity`
// is a free-form text column server-side, so a row can carry a value the enum
// doesn't list. Those are dropped rather than counted into the wrong bucket.
export function tallySeverities(findings: { severity: string }[]): SeverityBreakdown {
  const counts = { ...EMPTY_BREAKDOWN };
  for (const f of findings) {
    if (isTallySeverity(f.severity)) counts[f.severity] += 1;
  }
  return counts;
}

/** A rectangle in viewport coordinates — the subset of DOMRect we position from. */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

/**
 * Fixed-position coordinates for the hover card.
 *
 * Prefers sitting below the anchor cell and flips above it when the card would
 * run off the bottom of the viewport *and* there is more room above — which is
 * the common case for the last rows of a long PR list. Either way the result is
 * clamped inside the viewport, so a card taller than the window still starts on
 * screen instead of scrolling out of reach.
 */
export function popoverPosition(args: {
  anchor: AnchorRect;
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { top: number; left: number } {
  const { anchor, cardHeight, viewportWidth, viewportHeight } = args;

  const spaceBelow = viewportHeight - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const spaceAbove = anchor.top - POPOVER_GAP - POPOVER_MARGIN;
  const flipUp = cardHeight > spaceBelow && spaceAbove > spaceBelow;

  const rawTop = flipUp ? anchor.top - POPOVER_GAP - cardHeight : anchor.bottom + POPOVER_GAP;
  const maxTop = Math.max(POPOVER_MARGIN, viewportHeight - cardHeight - POPOVER_MARGIN);
  const top = Math.min(Math.max(rawTop, POPOVER_MARGIN), maxTop);

  const maxLeft = Math.max(POPOVER_MARGIN, viewportWidth - POPOVER_WIDTH - POPOVER_MARGIN);
  const left = Math.min(Math.max(anchor.left, POPOVER_MARGIN), maxLeft);

  return { top, left };
}
