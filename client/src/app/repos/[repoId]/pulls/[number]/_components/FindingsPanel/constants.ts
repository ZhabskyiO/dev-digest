import type { FindingActionKind } from "@devdigest/shared";

/** Confidence below this is hidden when "hide low confidence" is on. */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** Keyboard shortcut → finding action. */
export const KEY_TO_ACTION: Record<string, FindingActionKind> = {
  a: "accept",
  d: "dismiss",
};

/**
 * How long to keep a deep-linked finding centred after first scrolling to it.
 *
 * A cold load of `?finding=…` resolves several queries independently: the
 * reviews arrive, the card renders and is scrolled to — and then the Timeline
 * query lands and inserts a tall block ABOVE it, pushing the card back off
 * screen. Re-asserting the scroll for a short window absorbs that without
 * needing this panel to know which sibling queries are still in flight.
 */
export const SCROLL_SETTLE_MS = 800;
