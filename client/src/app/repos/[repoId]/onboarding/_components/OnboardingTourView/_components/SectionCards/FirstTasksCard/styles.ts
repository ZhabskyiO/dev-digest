import type { CSSProperties } from "react";
import type { OnboardingComplexity } from "@devdigest/shared";

const COMPLEXITY_COLOR: Record<OnboardingComplexity, string> = {
  low: "var(--ok)",
  medium: "var(--warn)",
  high: "var(--crit)",
};

export const s = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  title: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  target: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  // Colour reinforces the level; the badge's TEXT ("Low/Medium/High
  // complexity") is what actually conveys it, so this still reads fine in
  // greyscale (AC-46).
  badge: (complexity: OnboardingComplexity): CSSProperties => ({
    alignSelf: "flex-start",
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 11.5,
    fontWeight: 650,
    color: COMPLEXITY_COLOR[complexity],
    border: `1px solid ${COMPLEXITY_COLOR[complexity]}`,
  }),
} as const;
