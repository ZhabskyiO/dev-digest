/* hooks/useDocumentVisible.ts — a `visibilitychange`-backed boolean feeding the
 * two CI polling queries' `refetchInterval` (R12: "auto-refresh every 30s,
 * suspended while the document is hidden").
 *
 * NEVER reach for TanStack Query's `refetchIntervalInBackground` for this:
 * despite its name, `focusManager.isFocused()` (query-core) treats
 * `document.visibilityState !== "hidden"` as its OWN default signal — but the
 * option is a query-wide, all-or-nothing toggle with no per-hook boolean to
 * read, and mixing it with an explicit `poll` flag from callers would leave
 * two independent visibility mechanisms disagreeing. Feeding a single boolean
 * we own straight into `refetchInterval: visible ? 30_000 : false` keeps the
 * suspend/resume behavior explicit, testable without touching QueryClient
 * internals, and impossible to silently disable via the query-core default.
 */
"use client";

import { useEffect, useState } from "react";

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** True while the document is visible; flips on the browser's own
 *  `visibilitychange` event. SSR-safe: defaults to `true` when there is no
 *  `document` (server render), matching "poll unless we know otherwise". */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(isVisible);

  useEffect(() => {
    function handleVisibilityChange() {
      setVisible(isVisible());
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Cover the case where visibility already changed between the initial
    // render's `useState` initializer and this effect's subscription.
    handleVisibilityChange();
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return visible;
}
