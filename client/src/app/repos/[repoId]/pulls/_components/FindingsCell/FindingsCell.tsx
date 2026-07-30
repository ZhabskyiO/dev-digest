/* FindingsCell — the PR list's FINDINGS column: a per-severity tally that
   opens a read-only hover card listing that PR's findings.

   The tally arrives with the list payload (`findings_by_severity`, counted
   across every review on the PR). The card's detail is fetched lazily on
   hover through `usePrReviews`, which shares its cache with the PR detail
   page — so opening a card usually costs nothing after the first time. */
"use client";

import React from "react";
import { SEV, SeverityBadge } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import { sortBySeverity } from "@/lib/findings";
import { CELL_SEVERITIES, CLOSE_DELAY_MS, OPEN_DELAY_MS } from "./constants";
import { EMPTY_BREAKDOWN, totalFindings, type AnchorRect } from "./helpers";
import { FindingsPopover } from "./FindingsPopover";
import { s } from "./styles";
import { s as rowStyles } from "../../styles";

/** Three dashes under a count, lit in proportion to how many findings there are. */
function SeverityMeter({ color, count }: { color: string; count: number }) {
  return (
    <div style={s.sevBar} aria-hidden>
      {[1, 2, 3].map((n) => (
        <span key={n} style={s.sevDash(color, count >= n)} />
      ))}
    </div>
  );
}

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const counts = pr.findings_by_severity ?? EMPTY_BREAKDOWN;
  const total = totalFindings(counts);

  const cellRef = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = React.useState<AnchorRect | null>(null);
  const open = anchor !== null;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  // Timers outlive the row when the list re-renders mid-hover.
  React.useEffect(() => clearTimer, []);

  const openNow = () => {
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left });
  };
  const scheduleOpen = () => {
    if (total === 0) return;
    clearTimer();
    timer.current = setTimeout(openNow, OPEN_DELAY_MS);
  };
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  };

  // `enabled: !!prId` inside the hook means passing null keeps this idle until
  // the card actually opens.
  const reviews = usePrReviews(open ? pr.id : null);
  const findings = React.useMemo(
    () => sortBySeverity((reviews.data ?? []).flatMap((r) => r.findings)),
    [reviews.data],
  );

  if (total === 0) return <div style={rowStyles.muted}>—</div>;

  return (
    <div
      ref={cellRef}
      style={s.cell}
      tabIndex={0}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onFocus={openNow}
      onBlur={scheduleClose}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          clearTimer();
          setAnchor(null);
        }
      }}
      // Hovering the cell must not swallow the row's click-to-open-PR.
      onClick={(e) => e.stopPropagation()}
    >
      {CELL_SEVERITIES.map((sev) =>
        counts[sev] > 0 ? (
          <div key={sev} style={s.sevGroup}>
            <SeverityBadge severity={sev} count={counts[sev]} compact />
            <SeverityMeter color={SEV[sev].c} count={counts[sev]} />
          </div>
        ) : null,
      )}

      {open && anchor && (
        <FindingsPopover
          anchor={anchor}
          findings={findings}
          loading={reviews.isPending}
          error={reviews.isError}
          onMouseEnter={clearTimer}
          onMouseLeave={scheduleClose}
        />
      )}
    </div>
  );
}
