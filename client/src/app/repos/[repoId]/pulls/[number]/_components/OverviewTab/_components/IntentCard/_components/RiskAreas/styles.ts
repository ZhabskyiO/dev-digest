import type { CSSProperties } from "react";
import { Icon } from "@devdigest/ui";
import type { RiskAreaKind } from "@devdigest/shared";

/**
 * One icon + accent per `RiskAreaKind`. TEMPORARY DUPLICATE of the map still
 * defined in `../../IntentCard.tsx` (this component does not own that file —
 * a later task removes the original once it switches over to `<RiskAreas>`).
 * Exhaustive by construction: keyed by the union, so widening `RiskAreaKind`
 * in the shared contract fails typecheck here until an icon is chosen.
 */
export const RISK_AREA_STYLE: Record<
  RiskAreaKind,
  { icon: keyof typeof Icon; color: string }
> = {
  security: { icon: "Shield", color: "var(--crit)" },
  dependency: { icon: "Boxes", color: "var(--warn)" },
  performance: { icon: "Zap", color: "var(--sugg)" },
  data: { icon: "Database", color: "var(--accent)" },
  breaking: { icon: "AlertTriangle", color: "var(--crit)" },
  other: { icon: "Info", color: "var(--text-muted)" },
};

/** Co-located styles for RiskAreas. Mirrors the risk-areas block that used to
   live inline in IntentCard's styles.ts (`riskSection` / `scopeLabel` /
   `riskChips` / `riskChip`), extended with the per-chip disclosure and
   file-reference-link styles this component adds. */
export const s = {
  riskSection: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    paddingTop: 24,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  /* Matches IntentCard's `scopeLabel` shape so the heading reads level with
     IN SCOPE / OUT OF SCOPE above it, even though it now lives in a separate
     component. */
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.11em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  riskChips: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,
  /* Column layout (not the old inline-flex row): a chip can now carry an
     explanation paragraph and a list of file-reference links beneath its
     label, so the chip itself must stack. */
  riskChip: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 15,
    color: "var(--text-secondary)",
    lineHeight: 1.3,
    minWidth: 220,
  } satisfies CSSProperties,
  riskChipHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  riskChipLabel: {
    flexGrow: 1,
  } satisfies CSSProperties,
  /* A real <button>, not a styled `div` — keyboard operation (Enter/Space)
     comes free from the element, not from hand-rolled `onKeyDown`. */
  expandButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    transform: open ? "rotate(180deg)" : "rotate(0deg)",
    transition: "transform 120ms ease",
  }),
  explanation: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  fileRefList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,
  fileRefLink: {
    fontSize: 12.5,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
