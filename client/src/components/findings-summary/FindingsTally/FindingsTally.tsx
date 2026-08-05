/* FindingsTally — severity counts for a set of findings the caller already
   holds, with the shared hover card on the tally.

   Used by the run timeline and the review-run accordion headers, which both get
   their findings from `usePrReviews` on the PR detail page. The PR list's
   FINDINGS column composes the same pieces by hand instead, because its counts
   come from the server and its findings are fetched lazily on hover. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { sortBySeverity } from "@/lib/findings";
import { FindingsHoverCard } from "../FindingsHoverCard";
import { SeverityTally } from "../SeverityTally";
import { tallySeverities, totalFindings } from "../helpers";
import { useHoverCard } from "../useHoverCard";
import { s } from "../styles";

export function FindingsTally({
  findings,
  /**
   * Gate blockers, from the run row's denormalized `blockers` column — NOT
   * recomputed from severities, because the gate threshold is per-agent
   * (`ciFailOn`) and is not always "CRITICAL".
   */
  blockers = 0,
  /** Rendered in place of the tally when there are no findings ("0 finding(s)"). */
  emptyLabel,
}: {
  findings: FindingRecord[];
  blockers?: number;
  emptyLabel?: string;
}) {
  const t = useTranslations("prReview");
  const counts = React.useMemo(() => tallySeverities(findings), [findings]);
  const sorted = React.useMemo(() => sortBySeverity(findings), [findings]);
  const total = totalFindings(counts);
  const { anchor, anchorProps, cardProps } = useHoverCard(total > 0);

  if (total === 0) {
    return emptyLabel ? <span style={s.blockers}>{emptyLabel}</span> : null;
  }

  return (
    <span {...anchorProps} style={s.tally}>
      <SeverityTally counts={counts} />
      {blockers > 0 && (
        <span style={s.blockers}>{t("runStatus.blockers", { count: blockers })}</span>
      )}
      {anchor && <FindingsHoverCard anchor={anchor} findings={sorted} scope="run" {...cardProps} />}
    </span>
  );
}
