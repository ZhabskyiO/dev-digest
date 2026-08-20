import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, margin: "24px" } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  path: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  body: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
};
