import type { CSSProperties } from "react";

/** Co-located styles for SkillDetail — header + tab bar + scrolling body. */
export const s = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "18px 24px 0",
  } satisfies CSSProperties,
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: { fontSize: 19, fontWeight: 700, minWidth: 0 } satisfies CSSProperties,
  headerMeta: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  tabsBar: { marginTop: 14 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 24 } satisfies CSSProperties,
} as const;
