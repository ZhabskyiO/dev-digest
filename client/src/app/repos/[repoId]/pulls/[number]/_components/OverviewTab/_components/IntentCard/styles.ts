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
    borderRadius: 14,
    background: "var(--bg-elevated)",
    padding: 26,
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,
  /* The statement is the card's headline, not a caption — it carries its own
     quotation marks (added in the component) instead of the old left rule. */
  statement: {
    margin: 0,
    fontSize: 19,
    fontStyle: "italic",
    fontWeight: 400,
    color: "var(--text-primary)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  /* auto-fit keeps the two scope columns side by side on a wide card and
     collapses them to one column on a narrow one — no media query needed,
     which inline style objects cannot express. */
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 32,
  } satisfies CSSProperties,
  scopeBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  /* Shared by both scope headers and the risk-areas header. IN SCOPE overrides
     `color` to --ok inline; everything else inherits the muted default. */
  scopeLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.11em",
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
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  scopeItem: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 15,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  /* Fixed width so wrapped item text stays flush with the first line. */
  scopeBullet: {
    flexShrink: 0,
    width: 4,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* The rule above RISK AREAS. `box` already supplies the gap below the scope
     grid, so the divider needs only its own padding above the label. */
  riskSection: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    paddingTop: 24,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  riskChips: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,
  riskChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 15,
    color: "var(--text-secondary)",
    lineHeight: 1.3,
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
  /* Failure of the manual re-derive. Inline and above the card so the previous
     (still valid) intent stays readable underneath — the POST failing does not
     invalidate what is already stored. */
  recalcError: {
    margin: "0 0 12px",
    fontSize: 12.5,
    color: "var(--crit)",
  } satisfies CSSProperties,
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
