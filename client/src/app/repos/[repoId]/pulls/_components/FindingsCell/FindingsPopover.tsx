/* FindingsPopover — the read-only hover card behind the PR list's FINDINGS
   cell. Portalled to <body> because the table card clips its overflow. */
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
import { POPOVER_MAX_FINDINGS } from "./constants";
import { popoverPosition, type AnchorRect } from "./helpers";
import { s } from "./styles";

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

export function FindingsPopover({
  anchor,
  findings,
  loading,
  error,
  onMouseEnter,
  onMouseLeave,
}: {
  anchor: AnchorRect;
  /** Already sorted by severity; empty while loading. */
  findings: FindingRecord[];
  loading: boolean;
  error: boolean;
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
      aria-label={t("list.columns.findings")}
      style={s.popover(pos.top, pos.left)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // The PR row navigates on click; a click inside the card must not.
      onClick={(e) => e.stopPropagation()}
    >
      <div style={s.popoverHeader}>
        <Icon.Info size={13} />
        {loading || error ? t("list.columns.findings") : t("list.findings.title", { count: findings.length })}
      </div>

      {loading && (
        <div style={s.popoverState}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!loading && error && <div style={s.popoverState}>{t("list.findings.error")}</div>}
      {!loading && !error && findings.length === 0 && (
        <div style={s.popoverState}>{t("list.findings.empty")}</div>
      )}

      {!loading && !error && findings.length > 0 && (
        <>
          <div style={s.popoverList}>
            {shown.map((f) => (
              <FindingItem key={f.id} f={f} />
            ))}
          </div>
          {hidden > 0 && (
            <div style={s.popoverMore}>{t("list.findings.more", { count: hidden })}</div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
