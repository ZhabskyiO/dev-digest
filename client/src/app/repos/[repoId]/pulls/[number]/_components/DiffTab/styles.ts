import type { CSSProperties } from "react";

/** Co-located styles for DiffTab — the summary bar above the diff. */

const segBase: CSSProperties = {
  padding: "5px 14px",
  borderRadius: 6,
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  color: "var(--text-muted)",
};

export const s = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 14,
  } satisfies CSSProperties,
  /** Cost note under the bar — shown in both orders, neither of which spends a token. */
  tokenNote: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingTop: 14,
    marginBottom: 18,
    borderTop: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bolt: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
  summary: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  add: { color: "var(--code-add-text)" } satisfies CSSProperties,
  del: { color: "var(--code-del-text)" } satisfies CSSProperties,
  segmented: {
    display: "inline-flex",
    gap: 2,
    padding: 3,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  seg: segBase,
  segActive: {
    ...segBase,
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
