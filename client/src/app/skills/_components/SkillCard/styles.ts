import type { CSSProperties } from "react";

/** Co-located styles for SkillCard (mirrors AgentCard's styles.ts). */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: 14,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.6,
    marginBottom: 10,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "8px 0",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingTop: 9,
    borderTop: "1px solid var(--border)",
    fontSize: 11.5,
    color: "var(--text-muted)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** Same accept-rate bands as the Stats tab, so a card and its tab agree. */
  accept: (pct: number): CSSProperties => ({
    color: pct >= 60 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--crit)",
    fontWeight: 600,
  }),
  typeChip: (color: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 8px",
    borderRadius: 4,
  }),
} as const;
