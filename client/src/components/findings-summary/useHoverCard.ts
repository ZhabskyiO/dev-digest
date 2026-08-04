"use client";

import React from "react";
import { CLOSE_DELAY_MS, OPEN_DELAY_MS } from "./constants";
import type { AnchorRect } from "./helpers";

/**
 * Hover-with-grace-period state for an anchored card.
 *
 * The card is portalled to `<body>`, so it cannot be a DOM child of its anchor
 * and the pointer necessarily leaves the anchor to reach it. The close delay is
 * what makes that gap survivable: `cancelClose` on the card's own mouseenter
 * keeps it open once the pointer lands inside.
 *
 * `anchor` is captured at open time rather than read on every render — a
 * DOMRect taken during render would be stale the moment the page scrolls.
 */
export function useHoverCard(enabled = true) {
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = React.useState<AnchorRect | null>(null);

  const cancelTimer = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Timers outlive the row when the list re-renders mid-hover.
  React.useEffect(() => cancelTimer, [cancelTimer]);

  const openNow = React.useCallback(() => {
    if (!enabled) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left });
  }, [enabled]);

  const close = React.useCallback(() => {
    cancelTimer();
    setAnchor(null);
  }, [cancelTimer]);

  const scheduleOpen = React.useCallback(() => {
    if (!enabled) return;
    cancelTimer();
    timer.current = setTimeout(openNow, OPEN_DELAY_MS);
  }, [cancelTimer, enabled, openNow]);

  const scheduleClose = React.useCallback(() => {
    cancelTimer();
    timer.current = setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  }, [cancelTimer]);

  /** Spread onto the anchor element. */
  const anchorProps = {
    ref: anchorRef as React.Ref<never>,
    tabIndex: 0,
    onMouseEnter: scheduleOpen,
    onMouseLeave: scheduleClose,
    onFocus: openNow,
    onBlur: scheduleClose,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && anchor) close();
    },
  };

  /** Spread onto the card so the pointer can travel into it. */
  const cardProps = { onMouseEnter: cancelTimer, onMouseLeave: scheduleClose };

  return { anchor, open: anchor !== null, anchorProps, cardProps, close };
}
