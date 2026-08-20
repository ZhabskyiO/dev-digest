import type { CSSProperties } from "react";

/** Co-located styles for the keyboard-operable attachment checkbox list. */
export const s = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px",
    borderRadius: 6,
  } satisfies CSSProperties,
  /** The drag handle. A real <button>, so it is focusable for dnd-kit's
   *  KeyboardSensor — hence the explicit button reset. */
  grip: {
    color: "var(--text-muted)",
    display: "inline-flex",
    flexShrink: 0,
    padding: 0,
    border: "none",
    background: "none",
    cursor: "grab",
    touchAction: "none",
  } satisfies CSSProperties,
  checkbox: (checked: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: 4,
    border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
    background: checked ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    padding: 0,
  }),
  name: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  dir: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  spacer: { flex: 1, minWidth: 8 } satisfies CSSProperties,
  tokens: {
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  empty: {
    padding: "24px 10px",
    textAlign: "center",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};
