import type { CSSProperties } from "react";

export const s = {
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowMain: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    minWidth: 0,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  path: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  why: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  openBtn: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    fontSize: 12.5,
    fontWeight: 500,
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
