import type { CSSProperties } from "react";
import type { AgentPickerVariant } from "./AgentPicker";

/** Co-located styles for the shared multi-agent AgentPicker. `variant`
 *  distinguishes the "full" configure-run page (large cards) from the
 *  "compact" quick-picker dropdown (dense rows) — see AgentPicker.tsx. */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  linkButton: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent-text)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  } satisfies CSSProperties,
  list: (variant: AgentPickerVariant): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: variant === "full" ? 8 : 2,
  }),
  row: (variant: AgentPickerVariant, checked: boolean): CSSProperties => ({
    display: "flex",
    alignItems: variant === "full" ? "flex-start" : "center",
    gap: 10,
    padding: variant === "full" ? "12px 14px" : "7px 8px",
    borderRadius: 8,
    border: "1px solid " + (checked ? "var(--accent)" : "var(--border)"),
    background: checked ? "var(--bg-hover)" : "var(--bg-elevated)",
    cursor: "pointer",
  }),
  checkbox: (checked: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    flexShrink: 0,
    marginTop: 2,
    borderRadius: 4,
    border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
    background: checked ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    padding: 0,
  }),
  iconBox: {
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-base)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  nameRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  } satisfies CSSProperties,
  name: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  estimate: {
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
  summary: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  aggregate: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
};
