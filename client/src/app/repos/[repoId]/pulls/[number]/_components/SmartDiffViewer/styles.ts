import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 26 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBottom: 2,
  } satisfies CSSProperties,
  groupDot: {
    width: 9,
    height: 9,
    borderRadius: 2,
    flexShrink: 0,
  } satisfies CSSProperties,
  groupLabel: {
    fontSize: 13.5,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  groupHint: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groupCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* The per-file findings badge in the card header. A real <button>: it is the
     keyboard path to the finding, and it must not toggle the card behind it. */
  findingsBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 9px",
    borderRadius: 5,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
  splitBox: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
  } satisfies CSSProperties,
  splitTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--warn)",
  } satisfies CSSProperties,
  splitBody: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  splitList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  splitChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  empty: {
    padding: 24,
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
