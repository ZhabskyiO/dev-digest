import type { CSSProperties } from "react";

export const s = {
  notice: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
  surfaceHeading: {
    fontSize: 13,
    fontWeight: 650,
    color: "var(--text-primary)",
    margin: "0 0 8px",
  } satisfies CSSProperties,
  group: { marginTop: 10 } satisfies CSSProperties,
  groupHeading: {
    fontSize: 11.5,
    fontWeight: 650,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    margin: "0 0 6px",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  method: {
    fontSize: 11.5,
    fontWeight: 700,
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  route: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
