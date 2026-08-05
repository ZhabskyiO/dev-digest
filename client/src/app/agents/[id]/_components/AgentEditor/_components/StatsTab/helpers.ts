import type { SkillUsage } from "@devdigest/shared";

/**
 * Highest `runs` count among the usage rows, so BarRow bars scale relative to
 * each other. Floors at 1 to avoid a divide-by-zero in BarRow's width math if
 * every row were somehow 0.
 */
export function maxRuns(rows: readonly SkillUsage[]): number {
  return Math.max(1, ...rows.map((r) => r.runs));
}

/** Colour band for the ACCEPT RATE ring — same thresholds as AgentCard's row. */
export function acceptRateColor(pct: number): string {
  if (pct >= 60) return "var(--ok)";
  if (pct >= 40) return "var(--warn)";
  return "var(--crit)";
}
