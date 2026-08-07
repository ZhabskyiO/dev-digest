import type { SkillCategoryCount } from "@devdigest/shared";
import { CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR } from "../../constants";

/** Accept-rate band, matching the agents StatsTab thresholds. */
export function acceptRateColor(pct: number): string {
  if (pct >= 60) return "var(--ok)";
  if (pct >= 40) return "var(--warn)";
  return "var(--crit)";
}

/** `category` is free text in the DB, so anything off-enum gets the fallback. */
export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? CATEGORY_FALLBACK_COLOR;
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function toDonutSegments(rows: SkillCategoryCount[]): DonutSegment[] {
  return rows.map((r) => ({
    label: r.category,
    value: r.count,
    color: categoryColor(r.category),
  }));
}
