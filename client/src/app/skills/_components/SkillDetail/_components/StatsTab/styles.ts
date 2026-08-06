import type { CSSProperties } from "react";

/** Co-located styles for the Skills StatsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  tiles: {
    display: "flex",
    gap: 14,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  caveat: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.55,
    marginBottom: 24,
    maxWidth: 760,
  } satisfies CSSProperties,
  panels: { display: "flex", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,
  panel: {
    flex: "1 1 320px",
    minWidth: 0,
    padding: "16px 18px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  } satisfies CSSProperties,
  agentName: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
