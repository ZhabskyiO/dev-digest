import type { CSSProperties } from "react";

/** Co-located styles for SectionCard — the shared frame every onboarding
    section card renders through. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "14px 16px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
  headingRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  iconWrap: {
    display: "inline-grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
    flexShrink: 0,
  } satisfies CSSProperties,
  heading: {
    fontSize: 15,
    fontWeight: 650,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(0deg)" : "rotate(-90deg)",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  body: {
    padding: "0 16px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  emptyLine: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
} as const;
