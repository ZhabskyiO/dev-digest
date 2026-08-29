/** Constants for FindingCard. */
import type { FindingActionKind } from "@devdigest/shared";

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";

/** Stable default for the `unavailableActions` prop — a fresh `[]` literal on
 *  every render would defeat any memoized consumer even though this card
 *  itself doesn't currently memoize on it. */
export const NO_UNAVAILABLE_ACTIONS: FindingActionKind[] = [];
