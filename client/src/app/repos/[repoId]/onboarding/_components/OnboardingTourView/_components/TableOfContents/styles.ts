import type { CSSProperties } from "react";

/** Co-located styles for TableOfContents — the sticky on-this-page rail. */
export const s = {
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  heading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
    paddingLeft: 11,
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
  entry: (active: boolean): CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    fontSize: 13,
    lineHeight: 1.4,
    padding: "6px 10px",
    borderRadius: 6,
    border: "none",
    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
  }),
} as const;
