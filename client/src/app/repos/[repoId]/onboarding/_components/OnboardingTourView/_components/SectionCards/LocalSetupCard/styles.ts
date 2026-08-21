import type { CSSProperties } from "react";

export const s = {
  list: { display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    listStyle: "none",
  } satisfies CSSProperties,
  index: {
    fontSize: 12,
    color: "var(--text-muted)",
    minWidth: 14,
    textAlign: "right",
  } satisfies CSSProperties,
  command: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
} as const;
