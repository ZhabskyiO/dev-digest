import type { CSSProperties } from "react";
import type { DiffKind } from "./helpers";

const DIFF_BG: Record<DiffKind, string> = {
  add: "var(--ok-bg)",
  del: "var(--crit-bg)",
  same: "transparent",
};
const DIFF_FG: Record<DiffKind, string> = {
  add: "var(--ok)",
  del: "var(--crit)",
  same: "var(--text-secondary)",
};

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  headRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 18,
    maxWidth: 720,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  versionPill: {
    minWidth: 34,
    padding: "3px 8px",
    borderRadius: 6,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  label: { fontSize: 14, fontWeight: 600, marginBottom: 2 } satisfies CSSProperties,
  unlabelled: {
    fontSize: 14,
    color: "var(--text-muted)",
    fontStyle: "italic",
    marginBottom: 2,
  } satisfies CSSProperties,
  date: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,

  diffBox: {
    marginTop: 10,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  diffHead: {
    padding: "7px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  diffScroll: { maxHeight: 360, overflow: "auto" } satisfies CSSProperties,
  diffLine: (kind: DiffKind): CSSProperties => ({
    display: "flex",
    background: DIFF_BG[kind],
    fontSize: 12.5,
    lineHeight: 1.6,
  }),
  // Gutter sizing lifted from components/diff-viewer/styles.ts so both diffs
  // line up the same way.
  diffNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  diffSign: (kind: DiffKind): CSSProperties => ({
    width: 14,
    flexShrink: 0,
    color: DIFF_FG[kind],
    userSelect: "none",
  }),
  diffText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    paddingRight: 12,
  } satisfies CSSProperties,
  identical: { padding: "12px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
