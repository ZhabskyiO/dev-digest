import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  note: {
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 6,
    padding: "8px 10px",
  } satisfies CSSProperties,
  lines: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    background: "var(--code-bg)",
  } satisfies CSSProperties,
  lineFor: (type: "context" | "added" | "removed"): CSSProperties => ({
    display: "flex",
    gap: 8,
    padding: "1px 10px",
    background: type === "added" ? "var(--code-add)" : type === "removed" ? "var(--code-del)" : "transparent",
  }),
  signFor: (type: "context" | "added" | "removed"): CSSProperties => ({
    width: 12,
    flexShrink: 0,
    color: type === "added" ? "var(--code-add-text)" : type === "removed" ? "var(--code-del-text)" : "var(--text-muted)",
  }),
  text: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
};
