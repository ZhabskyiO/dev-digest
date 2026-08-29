/* FindingMiniCard — a Columns-mode finding row: severity icon+label, title,
   file:line and a short rationale excerpt. All agent-authored text (`title`,
   `rationale`) renders as plain JSX text — never markdown, never markup, never
   an instruction — so a title/rationale carrying `<script>` or a prompt
   injection attempt is inert (AC-48). */
"use client";

import React from "react";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumnFinding } from "@devdigest/shared";
import { lineLabel } from "./helpers";
import { s } from "./styles";

export function FindingMiniCard({ finding }: { finding: AgentColumnFinding }) {
  return (
    <div style={s.findingCard}>
      <div style={s.findingHeader}>
        <SeverityBadge severity={finding.severity as Severity} compact />
        <span style={s.findingTitle}>{finding.title}</span>
      </div>
      <div className="mono" style={s.findingLocation}>
        {finding.file}:{lineLabel(finding)}
      </div>
      <div style={s.findingRationale}>{finding.rationale}</div>
    </div>
  );
}
