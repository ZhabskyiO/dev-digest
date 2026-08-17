import type { CSSProperties } from "react";

export const s = {
  /* Intent | Blast radius. `auto-fit` + a floor collapses the pair to one
     column on a narrow viewport without a media query — inline style objects
     cannot express one, and the two cards are equal-weight, so neither should
     win the space when only one fits.

     The floor is 560px, not 380: Blast Radius carries a five-stat row (new ·
     touched · callers · endpoints · cron/jobs) that has to read as one line,
     and below ~560px of card it wraps into an unreadable block. Paired with
     the page's 1320px cap that gives each card ~640px. */
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(560px, 1fr))",
    gap: 24,
    alignItems: "start",
    marginBottom: 28,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
