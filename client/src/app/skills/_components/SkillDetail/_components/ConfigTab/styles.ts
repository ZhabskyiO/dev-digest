import type { CSSProperties } from "react";

/** Co-located styles for the Skills ConfigTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  enabledBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 20,
  } satisfies CSSProperties,

  // Body editor composite: filename strip welded to the CodeMirror surface.
  editor: {
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  editorHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  editorFile: { fontSize: 12.5, color: "var(--text-primary)" } satisfies CSSProperties,
  tokenCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  actions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
  } satisfies CSSProperties,
} as const;
