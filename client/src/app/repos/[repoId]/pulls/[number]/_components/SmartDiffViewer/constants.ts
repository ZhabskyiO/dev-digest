import type { SmartDiffRole } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/**
 * Presentation constants for Smart Diff. The CLASSIFICATION thresholds and
 * patterns live server-side in `modules/reviews/smart-diff/constants.ts`;
 * what is here is purely how the three groups are shown.
 */

/** Dot colour + icon per role, keyed by the union so a new role won't compile. */
export const ROLE_STYLE: Record<SmartDiffRole, { color: string; icon: IconName }> = {
  core: { color: "var(--sugg)", icon: "Target" },
  wiring: { color: "var(--warn)", icon: "Link" },
  boilerplate: { color: "var(--text-muted)", icon: "Layers" },
};

/**
 * A file with no findings auto-expands only in `core`, and only when it is
 * small enough to be worth reading inline.
 *
 * `boilerplate` is absent on purpose: it NEVER auto-expands, even when it
 * carries a finding. That is the acceptance criterion ("a lockfile is always
 * boilerplate and initially collapsed") and the point of the feature — the
 * group exists to keep generated churn out of the reviewer's way. A finding in
 * a collapsed file is still announced by its header badge, and clicking that
 * badge expands the file and scrolls to the line.
 */
export const AUTO_EXPAND_ROLES: readonly SmartDiffRole[] = ["core"] as const;

/** Changed-line ceiling for auto-expanding a finding-free file. */
export const AUTO_EXPAND_MAX_LINES = 200;
