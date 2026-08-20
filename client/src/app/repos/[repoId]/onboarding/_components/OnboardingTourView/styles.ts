import type { CSSProperties } from "react";
import { CONTENT_MAX_WIDTH } from "./constants";

/** Co-located styles for OnboardingTourView — a two-column reading layout:
    a sticky on-this-page rail alongside the six section cards. */
export const s = {
  /** AppFrame's <main> adds no padding — each page owns its own. */
  content: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: "100%",
    padding: "32px 24px",
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  layout: {
    display: "flex",
    alignItems: "flex-start",
    gap: 32,
  } satisfies CSSProperties,
  tocRail: {
    width: 200,
    flexShrink: 0,
    position: "sticky",
    top: 24,
  } satisfies CSSProperties,
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
