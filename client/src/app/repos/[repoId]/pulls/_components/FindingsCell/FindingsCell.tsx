/* FindingsCell — the PR list's FINDINGS column: a per-severity tally that
   opens a read-only hover card listing that PR's findings.

   The tally arrives with the list payload (`findings_by_severity`, counted
   across every review on the PR). The card's detail is fetched lazily on
   hover through `usePrReviews`, which shares its cache with the PR detail
   page — so opening a card usually costs nothing after the first time.

   This composes the shared `findings-summary` pieces by hand rather than using
   `FindingsTally`, because that component assumes the caller already holds the
   findings; here they arrive only once the card opens. */
"use client";

import React from "react";
import {
  EMPTY_BREAKDOWN,
  FindingsHoverCard,
  SeverityTally,
  findingsSummaryStyles as s,
  totalFindings,
  useHoverCard,
} from "@/components/findings-summary";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import { sortBySeverity } from "@/lib/findings";
import { s as rowStyles } from "../../styles";

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const counts = pr.findings_by_severity ?? EMPTY_BREAKDOWN;
  const total = totalFindings(counts);
  const { anchor, open, anchorProps, cardProps } = useHoverCard(total > 0);

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
      {...anchorProps}
      style={s.tally}
      // Hovering the cell must not swallow the row's click-to-open-PR.
      onClick={(e) => e.stopPropagation()}
    >
      <SeverityTally counts={counts} bars />
      {anchor && (
        <FindingsHoverCard
          anchor={anchor}
          findings={findings}
          loading={reviews.isPending}
          error={reviews.isError}
          {...cardProps}
        />
      )}
    </div>
  );
}
