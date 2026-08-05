import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { maxWidth: 1100 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" } satisfies CSSProperties,
  panel: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 8 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  caveat: { fontSize: 12.5, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "10px 0" } satisfies CSSProperties,
} as const;
