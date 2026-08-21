import type { CSSProperties } from "react";

/**
 * Co-located styles for BriefCard. `section`/`skeletonWrap`/`errorBox` mirror
 * the shell already established by IntentCard/BlastCard (same border/radius/
 * padding scale) so the brief container sits level with its neighbours; the
 * rest (`notice`, `verdictBox`, `footer`, empty-state block) is specific to
 * this card.
 */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,

  /* Intent | Blast radius, side by side INSIDE the full-width brief. They are
     the pair a reviewer reads against each other (an intent scoped to
     /api/public/* next to a blast radius naming three other endpoints is the
     signal), so they stay level with one another while the verdict block and
     review focus above and below them span the whole brief.

     This grid moved here from OverviewTab: while `BriefCard` and `BlastCard`
     were siblings in that grid, the brief itself only ever got half the width
     and stacked Intent inside that half.

     `auto-fit` + a floor collapses the pair to one column on a narrow viewport
     without a media query (an inline style object cannot express one), and
     collapses the empty track when only one child is rendered. The floor is
     560px, not 380: Blast Radius carries a five-stat row that has to read as
     one line and wraps into an unreadable block below that. */
  pairGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(560px, 1fr))",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,

  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,

  /* Generate/refresh control row, plus its dismissible failure alert. Sits
     above the brief content (or inside the empty-state box) so the control
     reads as the one thing on this card that spends tokens. */
  controlsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  } satisfies CSSProperties,

  errorBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "8px 12px",
  } satisfies CSSProperties,
  errorText: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text-secondary)",
    fontSize: 13,
  } satisfies CSSProperties,
  dismissBtn: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,

  /* Stale/degraded banners. Both are `role="status"` — visible, non-blocking
     notices that sit above the brief content without hiding it (AC-12/AC-13
     both require the brief to stay readable underneath). */
  notice: (tone: "warn" | "muted"): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${tone === "warn" ? "var(--warn)" : "var(--border-strong)"}`,
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  }),
  noticeTitle: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  /* Text + the regenerate control stacked inside the stale notice — the one
     state where the control lives in the notice rather than the controls
     row above the brief (see BriefCard's own comment on AC-12 / AC-43). */
  staleBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,

  /* Empty state — no brief generated yet. Built by hand rather than with
     `@devdigest/ui`'s `EmptyState` primitive: that component always renders
     its cta as `kind="secondary"` and has no slot for a notice between the
     hint and the button, but AC-2/AC-46 need a `primary` button and the
     token notice ordered ahead of it. */
  emptyBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 8,
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--bg-elevated)",
    padding: "48px 28px",
  } satisfies CSSProperties,
  emptyIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,
  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  emptyHint: {
    fontSize: 14,
    color: "var(--text-secondary)",
    maxWidth: 380,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  emptyTokenNotice: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    maxWidth: 380,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  emptyControls: {
    marginTop: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,

  /* PR-level verdict rollup — shares the pill/score-column shape used by
     `prReview`'s VerdictBanner, kept local rather than importing that
     component so this card owns its own (differently-labelled) copy. */
  verdictBox: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  verdictIconBox: (bg: string, color: string): CSSProperties => ({
    width: 38,
    height: 38,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  verdictMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  verdictLabel: (color: string): CSSProperties => ({
    fontSize: 16,
    fontWeight: 700,
    color,
  }),
  verdictStats: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  verdictScoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  } satisfies CSSProperties,
  verdictScoreLabel: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    fontSize: 12.5,
    color: "var(--text-muted)",
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
} as const;
