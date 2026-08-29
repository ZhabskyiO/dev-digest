import type { CSSProperties } from "react";

/** Co-located styles for RunReviewDropdown. The shared `Dropdown`
   (`@devdigest/ui`) only renders a flat `DropdownItemDef[]` list — this
   component's body is `AgentPicker`, an arbitrary React subtree — so the
   popover chrome is inlined here instead, reusing the same visual tokens
   `Dropdown` uses elsewhere (`--shadow-modal`, the `ddpop` open animation). */
export const s = {
  root: {
    position: "relative",
    display: "inline-block",
  } satisfies CSSProperties,
  panel: (width: number): CSSProperties => ({
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 12,
    zIndex: 40,
    animation: "ddpop .12s ease",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  }),
  warning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 12.5,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  configureLink: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent-text)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
};
