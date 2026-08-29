import type { CiRunStatus } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** `CiRunsQuery.window` values, in display order (default is `"7d"`). */
export const WINDOW_VALUES = ["24h", "7d", "30d", "all"] as const;
export type CiWindowValue = (typeof WINDOW_VALUES)[number];

/** `CiRunStatus` values, in display order for the status filter. */
export const STATUS_VALUES: CiRunStatus[] = ["running", "succeeded", "no_findings", "skipped", "failed"];

/** `runs.filters.status.*` / `runs.status.*` catalogue key for each status —
 *  the catalogue camelCases `no_findings` to `noFindings`. */
export const STATUS_LABEL_KEY: Record<CiRunStatus, string> = {
  running: "running",
  succeeded: "succeeded",
  no_findings: "noFindings",
  skipped: "skipped",
  failed: "failed",
};

/** Icon + colour per status. Colour is never the only signal (AC-41) — every
 *  render site pairs this with the translated `STATUS_LABEL_KEY` text.
 *  `skipped` (the review job never ran — a fork PR, or the DevDigest install
 *  PR itself before the bundle lands on the base branch) is deliberately
 *  neutral/muted, not red — it isn't a failure. */
export const STATUS_META: Record<CiRunStatus, { icon: IconName; color: string; bg: string }> = {
  running: { icon: "RefreshCw", color: "var(--accent)", bg: "var(--bg-elevated)" },
  succeeded: { icon: "CheckCircle", color: "var(--ok)", bg: "var(--ok-bg)" },
  no_findings: { icon: "Check", color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  skipped: { icon: "Slash", color: "var(--text-muted)", bg: "var(--bg-hover)" },
  failed: { icon: "XCircle", color: "var(--crit)", bg: "var(--crit-bg)" },
};

/** Fallback for a status outside `CiRunStatus` (`CiRun.status` is a loose
 *  nullable string at the contract level) — never crash on unexpected data. */
export const UNKNOWN_STATUS_META: { icon: IconName; color: string; bg: string } = {
  icon: "Info",
  color: "var(--text-muted)",
  bg: "var(--bg-hover)",
};

/** `runs.table.*` column keys, in display order (AC-46's six columns). */
export const COLUMN_KEYS = [
  "timestamp",
  "pullRequest",
  "source",
  "findings",
  "cost",
  "status",
] as const;

/** Grid template shared by the header row and every `RunRow` — one extra
 *  trailing column for the per-row GitHub link, which has no header label. */
export const GRID = "160px 100px 110px 90px 90px 150px 90px";

export const SKELETON_ROWS = 5;
