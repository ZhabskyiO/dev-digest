/* Pure helpers for MultiAgentResults — no React, no hooks. */
import type { AgentColumn } from "@devdigest/shared";

/**
 * The two results view modes. The `?view=` allowlist MUST be derived from
 * this array, never restated as a literal elsewhere — a hand-written
 * allowlist that drifts from the real mode set is exactly how the agents
 * page's Context tab silently bounced back to Config
 * (client/insights/INSIGHTS.md 2026-08-19).
 */
export const VIEW_MODES = ["columns", "tabs"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Translation key (under `runs.page.results`) for a view mode's label. */
export const VIEW_MODE_LABEL_KEY: Record<ViewMode, "modeColumns" | "modeTabs"> = {
  columns: "modeColumns",
  tabs: "modeTabs",
};

export function isViewMode(value: string | null): value is ViewMode {
  return value != null && (VIEW_MODES as readonly string[]).includes(value);
}

/** run_ids of every column still running — the single shared `useRunEvents`
 *  subscription this page owns is keyed off this list (AC-36). */
export function runningRunIds(columns: AgentColumn[]): string[] {
  return columns.filter((c) => c.status === "running").map((c) => c.run_id);
}

/** Run duration in whole seconds with one decimal, for `runs.json`'s
 *  `page.meta` template (which already appends "s total" itself). Falls back
 *  to "0.0" while no duration is known yet (queued / just started). */
export function metaDurationSec(totalDurationMs: number | null | undefined): string {
  if (totalDurationMs == null || !Number.isFinite(totalDurationMs)) return "0.0";
  return (totalDurationMs / 1000).toFixed(1);
}
