import type { CSSProperties } from "react";

/** Co-located styles for ReviewFocus — a bare list of clickable "look here
   first" rows, so it stays visually lighter than the card shells (BlastCard,
   IntentCard) it sits alongside on the Overview tab. */
export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  item: {
    margin: 0,
  } satisfies CSSProperties,
  row: {
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
  location: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    flexShrink: 0,
    paddingTop: 1,
  } satisfies CSSProperties,
  reason: {
    fontSize: 13,
    color: "var(--text-primary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
};
