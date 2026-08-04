/* SeverityTally — an icon + count per non-zero severity. Shared by the PR
   list's FINDINGS column, the run timeline, and the review-run accordion. */
"use client";

import React from "react";
import { SEV, SeverityBadge } from "@devdigest/ui";
import { TALLY_SEVERITIES, type SeverityBreakdown } from "./constants";
import { s } from "./styles";

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

export function SeverityTally({
  counts,
  /** Decorative mini bars under each count — the PR list column only. */
  bars,
}: {
  counts: SeverityBreakdown;
  bars?: boolean;
}) {
  return (
    <>
      {TALLY_SEVERITIES.map((sev) =>
        counts[sev] > 0 ? (
          <div key={sev} style={s.sevGroup}>
            <SeverityBadge severity={sev} count={counts[sev]} compact />
            {bars && <SeverityMeter color={SEV[sev].c} count={counts[sev]} />}
          </div>
        ) : null,
      )}
    </>
  );
}
