import type { CSSProperties } from "react";

/** Co-located styles for BlastCard. Mirrors IntentCard's shell (same section /
   box / error / unavailable shapes) so the two cards sit level in the Overview
   grid; everything below `statRow` is specific to the impact map. */
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
    gap: 18,
  } satisfies CSSProperties,

  /* Counts read left-to-right as the funnel the map describes:
     symbols → callers → endpoints → crons. */
  statRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
  } satisfies CSSProperties,
  statNum: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  viewToggle: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
  } satisfies CSSProperties,
  viewBtn: (active: boolean): CSSProperties => ({
    border: "none",
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 500,
    textTransform: "capitalize",
    cursor: "pointer",
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-muted)",
  }),

  /* Status banner for anything short of a `ready` index. Deliberately loud:
     the failure mode this feature has to avoid is a thin map being read as a
     small blast radius. */
  banner: (tone: "warn" | "muted"): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${tone === "warn" ? "var(--warn)" : "var(--border-strong)"}`,
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  }),
  bannerTitle: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  symbolList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  symbolItem: {
    borderTop: "1px solid var(--border)",
    paddingTop: 12,
    marginTop: 12,
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolName: {
    fontSize: 14,
    fontWeight: 600,
  } satisfies CSSProperties,
  symbolCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  callerList: {
    margin: "10px 0 0",
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  callerItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingLeft: 22,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  chipRow: {
    margin: "12px 0 0",
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    paddingLeft: 22,
  } satisfies CSSProperties,
  chip: (tone: "endpoint" | "cron"): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    border: `1px solid ${tone === "endpoint" ? "var(--accent)" : "var(--warn)"}`,
    color: tone === "endpoint" ? "var(--accent-text)" : "var(--warn)",
    background: tone === "endpoint" ? "var(--accent-bg)" : "transparent",
  }),
  chipMethod: {
    fontWeight: 700,
  } satisfies CSSProperties,

  graphWrap: {
    overflowX: "auto",
  } satisfies CSSProperties,

  priorSection: {
    paddingTop: 16,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  priorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  priorList: {
    margin: "12px 0 0",
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  priorItem: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  priorNumber: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  priorOverlap: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  emptyBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 18,
    fontSize: 13.5,
    color: "var(--text-secondary)",
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
