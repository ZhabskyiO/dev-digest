import type { CSSProperties } from "react";

export const s = {
  prose: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
