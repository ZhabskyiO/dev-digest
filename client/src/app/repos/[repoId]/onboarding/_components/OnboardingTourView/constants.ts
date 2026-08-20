import type { OnboardingSectionKind } from "@devdigest/shared";

/**
 * The six section kinds in AC-1's fixed order — the single source of truth
 * for both the on-this-page order and the card composition order. T8
 * (server) enforces this same order when it grounds a draft into a stored
 * tour, but the client re-asserts it defensively here rather than trusting
 * `tour.sections`' own array order (see `orderedSections` in ./helpers).
 */
export const SECTION_ORDER: readonly OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "routes_and_apis",
  "local_setup",
  "reading_path",
  "first_tasks",
] as const;

/**
 * The reading column caps at the same width the other repo-scoped pages use
 * (conventions, project context) — `box-sizing: border-box` is global, so
 * this is the outer width including the column's own padding.
 */
export const CONTENT_MAX_WIDTH = 1240;

/** Skeleton rows shown while the tour is loading. */
export const SKELETON_CARD_COUNT = 3;

/** How long a "copied"/"copied to clipboard" confirmation shows before
 *  reverting — shared by Share link (TourHeader) and each LocalSetupCard row
 *  so the two independent copy affordances don't carry two separately
 *  hand-tuned literals for the same UX timing. */
export const COPY_RESET_MS = 1500;
