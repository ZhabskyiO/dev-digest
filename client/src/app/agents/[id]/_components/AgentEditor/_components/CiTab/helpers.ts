import type { CiInstallationStatus, CiRunStatus } from "@devdigest/shared";

/** `runs.status.*` catalogue key for a `CiRunStatus` — the catalogue
 *  camelCases `no_findings` to `noFindings` (mirrors the CI Runs page's own
 *  `STATUS_LABEL_KEY`, kept local here rather than imported across an
 *  unrelated route's private `_components` tree). */
const STATUS_LABEL_KEY: Record<CiRunStatus, string> = {
  running: "running",
  succeeded: "succeeded",
  no_findings: "noFindings",
  skipped: "skipped",
  failed: "failed",
};

/** Translation-catalogue key for a last run's status, or `null` for an
 *  unknown/missing status (no run yet, or a value outside `CiRunStatus`). */
export function statusLabelKey(status: string | null | undefined): string | null {
  if (!status || !(status in STATUS_LABEL_KEY)) return null;
  return STATUS_LABEL_KEY[status as CiRunStatus];
}

/** Distinct repos across the installation list — the "Active in N repos"
 *  badge counts REPOS, not rows (an agent can have multiple installations
 *  per repo in principle, e.g. different targets, and must not double-count). */
export function countDistinctRepos(rows: readonly CiInstallationStatus[]): number {
  return new Set(rows.map((row) => row.installation.repo)).size;
}

/** Coarse relative time ("now" / "12m" / "3h" / "5d") for a last-run
 *  timestamp — mirrors `pulls/helpers.ts`'s `relativeTime` but stays
 *  colocated here rather than importing across an unrelated feature folder. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
