import type { EvalBatch } from "@devdigest/shared";

/** 0.823 → "82" (rendered as "82%"). Null-safe: "—" when absent. */
export function pct(v: number | null | undefined): string {
  return v == null ? "—" : String(Math.round(v * 100));
}

/** Delta between two ratios in percentage points, rounded; undefined hides the chip. */
export function deltaPts(curr: number | null | undefined, prev: number | null | undefined): number | undefined {
  if (curr == null || prev == null) return undefined;
  return Math.round((curr - prev) * 100);
}

/** "2026-08-24T10:00:00Z" → "2026-08-24 10:00" (locale-stable, monospace-friendly). */
export function fmtRanAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Order a selected pair old → new for the compare modal. */
export function orderPair(a: EvalBatch, b: EvalBatch): [EvalBatch, EvalBatch] {
  return a.ran_at <= b.ran_at ? [a, b] : [b, a];
}
