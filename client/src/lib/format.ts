/**
 * Shared display formatters for run cost and token counts.
 *
 * Cost precision is adaptive because review runs span four orders of magnitude:
 * a single cheap run costs ~$0.0013, a PR total reaches dollars. A fixed
 * precision either shows `$0.00` for real spend or `$12.5000` for large totals.
 */

/** Rendered when a value is unknown. NEVER show `$0.00` for missing data — a
 *  run with no price is not a free run. */
export const NO_VALUE = "—";

/**
 * USD cost for display.
 *
 *   null / undefined → "—"      (unknown price, or a run that never completed)
 *   < $0.01          → 4 dp     ($0.0013 — sub-cent runs are the common case)
 *   < $1             → 3 dp     ($0.014)
 *   >= $1            → 2 dp     ($1.23)
 */
export function formatCostUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  const decimals = value < 0.01 ? 4 : value < 1 ? 3 : 2;
  return `$${value.toFixed(decimals)}`;
}

/** Token count with thousands separators (9119 → "9,119"). */
export function formatTokensCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  return Math.round(value).toLocaleString("en-US");
}

/** Run duration in seconds, one decimal place (6234ms → "6.2s"). */
export function formatDurationMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  return `${(value / 1000).toFixed(1)}s`;
}
