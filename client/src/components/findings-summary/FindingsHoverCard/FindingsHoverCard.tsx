/* FindingsHoverCard — the read-only card behind every severity tally: the PR
   list's FINDINGS column, the run timeline, and the review-run accordion.

   Portalled to <body> because both the PR list's table card and the accordion
   set `overflow: hidden`, which would clip an absolutely-positioned panel. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  CategoryTag,
  Icon,
  SeverityBadge,
  Skeleton,
  ConfidenceNum,
  type Category,
  type Severity,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { POPOVER_MAX_FINDINGS } from "../constants";
import { popoverPosition, type AnchorRect } from "../helpers";
import { s } from "../styles";

/** Line range label ("11" when single-line, else "11-15"). */
function lineLabel(f: FindingRecord): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

function FindingItem({ f }: { f: FindingRecord }) {
  return (
    <div style={s.item}>
      <div style={s.itemBadge}>
        <SeverityBadge severity={f.severity as Severity} compact />
      </div>
      <div style={s.itemMain}>
        <div style={s.itemTitle}>{f.title}</div>
        <div style={s.itemMeta}>
          <CategoryTag category={f.category as Category} />
        </div>
        <div style={s.itemMeta}>
          <span className="mono" style={s.itemLocation}>
            {f.file}:{lineLabel(f)}
          </span>
          <ConfidenceNum value={f.confidence} />
        </div>
        <div style={s.itemRationale}>{f.rationale}</div>
      </div>
    </div>
  );
}

export function FindingsHoverCard({
  anchor,
  findings,
  loading = false,
  error = false,
  scope = "pr",
  onMouseEnter,
  onMouseLeave,
}: {
  anchor: AnchorRect;
  /** Already sorted by severity; empty while loading. */
  findings: FindingRecord[];
  /** Only the PR list fetches on hover; the run surfaces already have the data. */
  loading?: boolean;
  error?: boolean;
  /** Picks the header wording: "N findings" vs "N findings in this run". */
  scope?: "pr" | "run";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useTranslations("prReview");
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  // First paint goes below the anchor with a zero-height guess; the layout
  // effect then re-positions from the real height (and flips it up if needed)
  // before the browser paints, so there is no visible jump.
  const [pos, setPos] = React.useState(() =>
    popoverPosition({
      anchor,
      cardHeight: 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }),
  );

  React.useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0;
    setPos(
      popoverPosition({
        anchor,
        cardHeight: height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, [anchor, findings.length, loading, error]);

  const shown = findings.slice(0, POPOVER_MAX_FINDINGS);
  const hidden = findings.length - shown.length;

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={t("findingsCard.label")}
      style={s.popover(pos.top, pos.left)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // A PR row navigates on click and an accordion header toggles on click;
      // a click inside the card must do neither.
      onClick={(e) => e.stopPropagation()}
    >
      <div style={s.popoverHeader}>
        <Icon.Info size={13} />
        {loading || error
          ? t("findingsCard.label")
          : t(scope === "run" ? "findingsCard.titleInRun" : "findingsCard.title", {
              count: findings.length,
            })}
      </div>

      {loading && (
        <div style={s.popoverState}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!loading && error && <div style={s.popoverState}>{t("findingsCard.error")}</div>}
      {!loading && !error && findings.length === 0 && (
        <div style={s.popoverState}>{t("findingsCard.empty")}</div>
      )}

      {!loading && !error && findings.length > 0 && (
        <>
          <div style={s.popoverList}>
            {shown.map((f) => (
              <FindingItem key={f.id} f={f} />
            ))}
          </div>
          {hidden > 0 && (
            <div style={s.popoverMore}>{t("findingsCard.more", { count: hidden })}</div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
