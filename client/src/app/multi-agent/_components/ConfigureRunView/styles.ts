import type { CSSProperties } from "react";

/** Co-located styles for the global Configure run page (`/multi-agent`). */
export const s = {
  wrap: {
    padding: "28px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 22,
    maxWidth: 780,
    margin: "0 auto",
  } satisfies CSSProperties,
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: "6px 0 0",
  } satisfies CSSProperties,
  step: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  stepBadge: (active: boolean): CSSProperties => ({
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 700,
    background: active ? "var(--accent)" : "var(--bg-elevated)",
    color: active ? "#fff" : "var(--text-muted)",
    border: active ? "none" : "1px solid var(--border)",
  }),
  stepLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  placeholder: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
};
