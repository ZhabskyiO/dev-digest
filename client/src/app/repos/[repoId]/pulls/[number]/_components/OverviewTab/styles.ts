import type { CSSProperties } from "react";

export const s = {
  /* The brief occupies the full content width. The Intent | Blast pair that
     used to live here is now a grid INSIDE `BriefCard` (`s.pairGrid` there) —
     while the brief and the blast card were siblings in a two-column grid the
     brief only ever got half the width, which squeezed the verdict block and
     stacked Intent inside that half. This rule now carries nothing but the
     gap to the Description section below. */
  briefRow: {
    marginBottom: 28,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
