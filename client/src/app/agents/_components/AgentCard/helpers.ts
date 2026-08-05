import { MODEL_COLOR } from "./constants";

/** Resolve the chip colour for an agent's model (unknown → secondary token). */
export function modelColor(model: string): string {
  return MODEL_COLOR[model] ?? "var(--text-secondary)";
}

/** Color band for an accept-rate percentage — a quick visual read on the card. */
export function acceptRateColor(pct: number): string {
  if (pct >= 60) return "var(--ok)";
  if (pct >= 40) return "var(--warn)";
  return "var(--crit)";
}
