import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } satisfies CSSProperties,
  total: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  advisory: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  overBudget: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
  } satisfies CSSProperties,
  overBudgetHead: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--warn)",
  } satisfies CSSProperties,
  droppedList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  droppedPath: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
};
