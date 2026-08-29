import type { CSSProperties } from "react";

/** Co-located styles for AgentTabs. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  tabStrip: {
    overflowX: "auto",
  } satisfies CSSProperties,
  summaryCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
  } satisfies CSSProperties,
  summaryMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  summaryTitleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  agentName: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  summaryText: { fontSize: 14, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  summaryMeta: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  traceLink: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent-text)",
    cursor: "pointer",
    fontSize: 12.5,
    fontWeight: 500,
  } satisfies CSSProperties,
  errorText: { fontSize: 13, color: "var(--crit)", margin: 0 } satisfies CSSProperties,
  findingsHeading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  findingsList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  confirmation: {
    fontSize: 12.5,
    color: "var(--ok)",
    margin: "4px 2px 0",
  } satisfies CSSProperties,
} as const;
