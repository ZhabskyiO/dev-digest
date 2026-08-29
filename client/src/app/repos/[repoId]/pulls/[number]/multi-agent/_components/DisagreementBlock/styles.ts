import type { CSSProperties } from "react";

/** Co-located styles for DisagreementBlock. */
export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  toggle: (active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 6,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--accent)" : "var(--border-strong)"),
    background: active ? "var(--accent)" : "var(--bg-hover)",
    color: active ? "#fff" : "var(--text-secondary)",
  }),
  empty: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 0",
  } satisfies CSSProperties,
  emptyTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  group: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-base)",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  file: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  range: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  takes: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,
  cell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRadius: 6,
    minWidth: 140,
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  agentName: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  didNotFlag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
};
