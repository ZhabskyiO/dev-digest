/* Constants for AgentColumns. */
import type { AgentColumn } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** The `runs.json` `page.results.status*` key for each terminal/live status. */
export type StatusLabelKey =
  | "statusQueued"
  | "statusRunning"
  | "statusDone"
  | "statusFailed"
  | "statusCancelled";

interface StatusMeta {
  icon: IconName;
  color: string;
  bg: string;
  labelKey: StatusLabelKey;
}

/** Icon + colour + catalogue key per `AgentColumn.status`. Colour is never
 *  the only signal — every status also renders its `labelKey` as text
 *  (WCAG 2.1 AA, never colour alone). */
export const STATUS_META: Record<AgentColumn["status"], StatusMeta> = {
  queued: { icon: "Clock", color: "var(--text-muted)", bg: "var(--bg-hover)", labelKey: "statusQueued" },
  running: { icon: "RefreshCw", color: "var(--accent)", bg: "var(--accent-bg)", labelKey: "statusRunning" },
  done: { icon: "CheckCircle", color: "var(--ok)", bg: "var(--ok-bg)", labelKey: "statusDone" },
  failed: { icon: "XCircle", color: "var(--crit)", bg: "var(--crit-bg)", labelKey: "statusFailed" },
  cancelled: { icon: "X", color: "var(--text-muted)", bg: "var(--bg-hover)", labelKey: "statusCancelled" },
};

/** Fixed column width so the row scrolls horizontally instead of squeezing
 *  columns (Q7 — no column cap, horizontal scroll instead). */
export const COLUMN_WIDTH = 300;
