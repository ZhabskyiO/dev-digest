import type { CSSProperties } from "react";
import { CONTENT_MAX_WIDTH } from "./constants";

/** Co-located styles for ConventionsView — a narrow review column. */
export const s = {
  /**
   * Caps the reading column and owns the page's padding — AppFrame's <main> adds
   * none, so each page pads itself (same as the pulls list).
   */
  content: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: "100%",
    padding: "32px 24px",
  } satisfies CSSProperties,
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  pageTitle: { fontSize: 22, fontWeight: 700, marginBottom: 4 } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  scanSummary: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 14,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 16,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
