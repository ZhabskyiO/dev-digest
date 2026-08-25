import type { CSSProperties } from "react";

/** Co-located styles for the skill EvalsTab. */
export const s = {
  wrap: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  count: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontFamily: "var(--font-mono, monospace)", fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  sevChip: {
    fontSize: 11,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
