import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  body: { padding: "20px 24px 4px" } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--accent-border, var(--border-strong))",
    background: "var(--accent-bg, var(--bg-surface))",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 20,
  } satisfies CSSProperties,
  row: { display: "flex", gap: 20 } satisfies CSSProperties,
  col: { flex: 1, minWidth: 0 } satisfies CSSProperties,

  // Body editor composite: a filename strip welded to a borderless textarea.
  // The kit's <Textarea> always draws its own border, which would double up
  // against the strip, so this one place styles the element directly.
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
  textarea: {
    width: "100%",
    display: "block",
    resize: "vertical",
    padding: "12px",
    border: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.6,
    outline: "none",
  } satisfies CSSProperties,

  error: { fontSize: 13, color: "var(--crit)", marginBottom: 12 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerNote: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footerActions: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
} as const;
