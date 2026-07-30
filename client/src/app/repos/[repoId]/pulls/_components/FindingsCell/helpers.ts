import {
  POPOVER_GAP,
  POPOVER_MARGIN,
  POPOVER_WIDTH,
  type SeverityBreakdown,
} from "./constants";

/** All-zero tally — what an unreviewed PR (or an older API) reports. */
export const EMPTY_BREAKDOWN: SeverityBreakdown = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };

export function totalFindings(counts: SeverityBreakdown): number {
  return counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
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
