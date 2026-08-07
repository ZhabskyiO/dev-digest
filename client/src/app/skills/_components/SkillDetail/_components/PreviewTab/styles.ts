import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 4 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
    marginBottom: 18,
  } satisfies CSSProperties,
  card: {
    padding: "22px 26px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 14,
    // An imported body can carry a long unbroken token; wrap rather than
    // scrolling the whole card sideways.
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  empty: { fontSize: 13.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
