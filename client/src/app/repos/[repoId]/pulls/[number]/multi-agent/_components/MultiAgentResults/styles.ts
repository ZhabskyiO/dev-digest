import type { CSSProperties } from "react";

/** Co-located styles for MultiAgentResults + ResultsHeader. */
export const s = {
  page: {
    padding: "24px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 1320,
    margin: "0 auto",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  headerTitles: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  meta: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  viewToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: 3,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  sharedError: {
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13.5,
  } satisfies CSSProperties,
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
