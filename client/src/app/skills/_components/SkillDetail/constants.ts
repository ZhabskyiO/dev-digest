import type { IconName } from "@devdigest/ui";

/** One entry in the detail pane's tab bar. Same shape as AgentEditor's TABS. */
export interface DetailTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

export const TABS: readonly DetailTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];

export const TAB_KEYS: readonly string[] = TABS.map((t) => t.key);
export const DEFAULT_TAB = "config";

/** Trailing window the Stats tab reports over. */
export const STATS_WINDOW_DAYS = 30;

/** Palette for the findings-by-category donut, by contract category. Anything
 *  outside the enum (the DB column is free text) falls back to the last colour. */
export const CATEGORY_COLOR: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "#8b5cf6",
  style: "#3b82f6",
  test: "var(--ok)",
};
export const CATEGORY_FALLBACK_COLOR = "var(--text-muted)";
