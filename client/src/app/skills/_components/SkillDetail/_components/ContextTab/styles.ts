import type { CSSProperties } from "react";

/** Co-located styles for the skill's "Project context to use" section. */
export const s = {
  /** Section heading above each list — same treatment as the agent Context
   *  tab's, so the two tabs read as one feature. */
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginTop: 6,
  } satisfies CSSProperties,
  wrap: { maxWidth: 900, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 } satisfies CSSProperties,
  repoHint: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 16,
    maxWidth: 640,
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 20 } satisfies CSSProperties,
  driftList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 } satisfies CSSProperties,
  driftRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  driftPath: { flex: 1, fontSize: 12.5, color: "var(--text-primary)" } satisfies CSSProperties,
  driftPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    marginTop: 10,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  driftPanelHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" } satisfies CSSProperties,
  driftPanelTitle: { fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
} as const;
