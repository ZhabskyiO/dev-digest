import type { CSSProperties } from "react";
import { RAIL_WIDTH } from "./constants";

/** Co-located styles for SkillsListView — split-pane, same shape as /agents/:id. */
export const s = {
  shell: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  railHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  railTitleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  railList: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  railSkeletons: { padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  // SkillDetail is a flex column that scrolls its own body, so the pane must
  // stretch it and NOT add a second scrollbar of its own.
  detail: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    overflow: "hidden",
  } satisfies CSSProperties,
  selectPrompt: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 8,
    padding: 28,
  } satisfies CSSProperties,
  selectPromptTitle: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  selectPromptBody: {
    fontSize: 14,
    color: "var(--text-secondary)",
    maxWidth: 320,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
