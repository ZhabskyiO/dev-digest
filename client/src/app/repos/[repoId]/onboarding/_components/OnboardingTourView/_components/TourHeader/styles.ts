import type { CSSProperties } from "react";

/** Co-located styles for TourHeader — title, subtitle, notices, and the
    Regenerate / Share link actions. */
export const s = {
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
  } satisfies CSSProperties,
  titleCol: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 4,
  } satisfies CSSProperties,
  repoName: {
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  actions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noticeText: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,
  noticeStack: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
} as const;
