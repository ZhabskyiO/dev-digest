import type { CSSProperties } from "react";

/** Co-located styles for IntentCard — inline style objects + CSS custom
   properties, per the repo convention (see sibling OverviewTab/styles.ts). */
export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  statement: {
    margin: 0,
    borderLeft: "2px solid var(--border)",
    paddingLeft: 14,
    fontSize: 14,
    fontStyle: "italic",
    color: "var(--text-primary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  claimNote: {
    margin: 0,
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /* auto-fit keeps the two scope columns side by side on a wide card and
     collapses them to one column on a narrow one — no media query needed,
     which inline style objects cannot express. */
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 18,
  } satisfies CSSProperties,
  scopeBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  scopeLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* Shown when the card displays scope lists the reviewer never received:
     at `low` confidence the prompt builder suppresses both lists (see
     reviewer-core/src/prompt.ts), so without this note the card would
     overstate what informed the review. */
  notPromptedNote: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    margin: 0,
    fontSize: 12,
    color: "var(--warn)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  scopeList: {
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  scopeItem: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  confidenceWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  unavailableBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  unavailableTitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  unavailableHint: {
    marginTop: 4,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  errorBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "12px 16px",
  } satisfies CSSProperties,
  errorLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "var(--text-secondary)",
    fontSize: 13.5,
  } satisfies CSSProperties,
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
