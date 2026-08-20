import type { CSSProperties } from "react";

export const s = {
  list: { display: "flex", flexDirection: "column", gap: 12, margin: 0, padding: 0 } satisfies CSSProperties,
  row: { display: "flex", gap: 12, listStyle: "none" } satisfies CSSProperties,
  badge: {
    flexShrink: 0,
    display: "inline-grid",
    placeItems: "center",
    width: 20,
    height: 20,
    borderRadius: 99,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontSize: 11.5,
    fontWeight: 700,
  } satisfies CSSProperties,
  textCol: { minWidth: 0 } satisfies CSSProperties,
  path: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  rationale: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 2,
  } satisfies CSSProperties,
} as const;
