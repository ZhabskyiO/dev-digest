import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  /* One per non-zero severity, left of the divider. Deliberately quiet: the
     row sits under a full-colour VerdictBanner, so loud chips here would
     compete with it. The icon carries the severity colour, and the label is
     always spelled out — never colour alone (WCAG AA).
     A <button> that jumps the list to that severity — hence `cursor: pointer`
     and the reset of the UA button font, which would otherwise shrink it. */
  sevChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "4px 12px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "transparent",
    font: "inherit",
    fontSize: 13,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    cursor: "pointer",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
