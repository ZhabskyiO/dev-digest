import type { ConventionCategory } from "@devdigest/shared";

/** Status tabs, in review order — pending first because that's the work. */
export const STATUS_FILTERS = ["pending", "accepted", "rejected", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * The review column is a reading column, not a dashboard — long rules and code
 * snippets get unreadable past ~90 characters, so it stays narrow regardless of
 * how wide the window is. This is the OUTER width: `box-sizing: border-box` is
 * global (vendor/ui/styles.css), so the container's own padding comes out of it.
 */
export const CONTENT_MAX_WIDTH = 1240;

/** Category accent, reusing the same palette the skill type chips draw from. */
export const CATEGORY_COLOR: Record<ConventionCategory, string> = {
  naming: "#3b82f6",
  structure: "#8b5cf6",
  "error-handling": "#ef4444",
  testing: "#10b981",
  typing: "#06b6d4",
  imports: "#f59e0b",
  "api-design": "#ec4899",
  styling: "#a3a3a3",
  other: "var(--text-muted)",
};

/** Suffix for the generated skill name: `<repo>-conventions`. */
export const SKILL_NAME_SUFFIX = "-conventions";

export const SKELETON_ROWS = 4;
