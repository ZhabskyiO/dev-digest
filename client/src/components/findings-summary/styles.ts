import type { CSSProperties } from "react";
import { POPOVER_WIDTH } from "./constants";

/** Co-located styles for the severity tally and its hover card. */
export const s = {
  tally: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    // Outline only on keyboard focus — the tally is hoverable, not clickable.
    outlineOffset: 2,
  } satisfies CSSProperties,
  /** Trailing " · N blockers" next to a tally, on the run surfaces. */
  blockers: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** One severity: the count badge with a mini bar beneath it. */
  sevGroup: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
  } satisfies CSSProperties,
  sevBar: { display: "flex", gap: 2 } satisfies CSSProperties,
  sevDash: (color: string, lit: boolean): CSSProperties => ({
    width: 5,
    height: 2,
    borderRadius: 1,
    background: color,
    opacity: lit ? 1 : 0.25,
  }),

  // ---- Hover card (portalled to <body>, so it is positioned in viewport px) ----
  popover: (top: number, left: number): CSSProperties => ({
    position: "fixed",
    top,
    left,
    width: POPOVER_WIDTH,
    maxWidth: "calc(100vw - 24px)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    zIndex: 40,
    animation: "ddpop .12s ease",
    overflow: "hidden",
    cursor: "default",
  }),
  popoverHeader: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  popoverList: {
    maxHeight: 380,
    overflowY: "auto",
    padding: "4px 0",
  } satisfies CSSProperties,
  popoverState: {
    padding: "14px",
    fontSize: 13,
    color: "var(--text-muted)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  popoverMore: {
    padding: "8px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // ---- One finding row inside the card ----
  item: {
    display: "flex",
    gap: 10,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  itemBadge: { flexShrink: 0, paddingTop: 1 } satisfies CSSProperties,
  itemMain: { minWidth: 0, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  itemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  itemMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    minWidth: 0,
  } satisfies CSSProperties,
  itemLocation: {
    fontSize: 12,
    color: "var(--accent-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** Rationale preview — two lines, then ellipsis. */
  itemRationale: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,
} as const;
