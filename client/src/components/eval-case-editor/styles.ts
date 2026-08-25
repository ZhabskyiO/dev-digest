import type { CSSProperties } from "react";

/** Co-located styles for CaseEditorModal. */
export const s = {
  cols: { display: "flex", gap: 22, minHeight: 440 } satisfies CSSProperties,
  col: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    margin: "0 0 8px",
  } satisfies CSSProperties,
  required: { color: "var(--crit)" } satisfies CSSProperties,
  inputHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    margin: "18px 0 6px",
  } satisfies CSSProperties,
  previewToggle: {
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    fontSize: 12,
    color: "var(--accent)",
    cursor: "pointer",
  } satisfies CSSProperties,
  metaFields: { display: "flex", flexDirection: "column", gap: 6, marginTop: 12 } satisfies CSSProperties,
  codeArea: {
    width: "100%",
    marginTop: 10,
    background: "var(--code-bg, var(--bg-primary))",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    lineHeight: 1.55,
    resize: "vertical",
  } satisfies CSSProperties,
  diffPre: {
    marginTop: 10,
    background: "var(--code-bg, var(--bg-primary))",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    lineHeight: 1.55,
    overflowX: "auto",
    maxHeight: 420,
    overflowY: "auto",
  } satisfies CSSProperties,
  expectedHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 2 } satisfies CSSProperties,
  structRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 } satisfies CSSProperties,
  structType: { width: 150, flexShrink: 0 } satisfies CSSProperties,
  structFile: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  lineInput: {
    width: 64,
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "8px 8px",
    font: "inherit",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
  } satisfies CSSProperties,
  lineDash: { color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  } satisfies CSSProperties,
  runOnSave: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  footerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
  seedBanner: (positive: boolean): CSSProperties => ({
    border: `1px solid ${positive ? "var(--accent)" : "var(--border-strong, var(--border))"}`,
    background: "var(--bg-elevated)",
    borderRadius: 10,
    padding: "12px 16px",
    marginBottom: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
  }),
  seedKind: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--accent)",
    marginBottom: 4,
  } satisfies CSSProperties,
  actualPre: {
    background: "var(--code-bg, var(--bg-primary))",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    maxHeight: 160,
    overflow: "auto",
    marginTop: 6,
  } satisfies CSSProperties,
  actualEmpty: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "18px 12px",
    marginTop: 6,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  banner: (pass: boolean): CSSProperties => ({
    marginTop: 12,
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: `1px solid ${pass ? "var(--ok)" : "var(--crit)"}`,
    color: pass ? "var(--ok)" : "var(--crit)",
    background: pass ? "var(--ok-bg, var(--bg-elevated))" : "var(--crit-bg, var(--bg-elevated))",
  }),
} as const;

/** Per-line diff colouring for the read-only preview. */
export function diffLineStyle(line: string): CSSProperties {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff "))
    return { color: "var(--text-muted)" };
  if (line.startsWith("@@")) return { color: "var(--accent)" };
  if (line.startsWith("+"))
    return { color: "var(--ok)", background: "var(--ok-bg, transparent)" };
  if (line.startsWith("-"))
    return { color: "var(--crit)", background: "var(--crit-bg, transparent)" };
  return { color: "var(--text-secondary)" };
}
