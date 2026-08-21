/* RiskAreas — the RISK AREAS block of IntentCard, extracted so the chip list
   can grow an optional per-area explanation disclosure and file-reference
   links without bloating IntentCard.tsx further.

   Presentational only: `areas` is Intent's `risk_areas`, a CLAIM from the
   Intent layer (see IntentCard.tsx's header comment) — a place to look, never
   a verdict, which is why nothing here reads as an alert.

   Renders `null`, heading included, when `areas` is empty (AC-19) — the
   heading is NOT the caller's job precisely so an empty section can vanish
   without the caller needing to know that. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { RiskArea } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { RISK_AREA_STYLE, s } from "./styles";

export function RiskAreas({
  areas,
  repoFullName,
  headSha,
}: {
  areas: RiskArea[];
  /** Used to build file-reference links; `null` when the PR's repo isn't
      known yet, in which case file references render without a link. */
  repoFullName: string | null;
  /** File-reference links are pinned to this sha, NEVER a branch name — a
      branch link would drift as soon as another commit lands (see
      `githubBlobUrl`'s own comment). */
  headSha: string;
}) {
  const t = useTranslations("brief");

  if (areas.length === 0) return null;

  return (
    <div style={s.riskSection}>
      <div style={s.sectionLabel}>
        <Icon.AlertTriangle size={15} aria-hidden="true" />
        {t("intent.riskAreas")}
      </div>
      <ul style={s.riskChips}>
        {areas.map((area, i) => (
          <RiskAreaChip
            key={`${i}-${area.label}`}
            index={i}
            area={area}
            repoFullName={repoFullName}
            headSha={headSha}
          />
        ))}
      </ul>
    </div>
  );
}

function RiskAreaChip({
  index,
  area,
  repoFullName,
  headSha,
}: {
  index: number;
  area: RiskArea;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("brief");
  const [expanded, setExpanded] = React.useState(false);
  // `area.kind` is server data that is never Zod-parsed client-side
  // (`api.get` casts, `lib/api.ts:62`) — fall back to a neutral entry before
  // dereferencing rather than throwing on an out-of-union value.
  const style = RISK_AREA_STYLE[area.kind] ?? RISK_AREA_STYLE.other;
  const Glyph = Icon[style.icon];
  const hasExplanation = Boolean(area.explanation);
  const fileRefs = area.file_refs ?? [];
  /* Stable per-render id, not `useId()`: it only has to be unique within this
     chip list, and `index` already is (see the chip's own `key` above). */
  const explanationId = `risk-area-${index}-explanation`;

  return (
    <li style={s.riskChip}>
      <div style={s.riskChipHeader}>
        <Glyph size={15} style={{ color: style.color, flexShrink: 0 }} aria-hidden="true" />
        <span style={s.riskChipLabel}>{area.label}</span>
        {hasExplanation && (
          <button
            type="button"
            style={s.expandButton}
            aria-expanded={expanded}
            aria-controls={explanationId}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t("riskAreas.collapse") : t("riskAreas.expand")}
            <Icon.ChevronDown size={13} style={s.chevron(expanded)} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Absent from the DOM — not just visually hidden — until expanded, so
          it is absent from the accessible tree exactly as AC-17 requires. */}
      {hasExplanation && expanded && (
        <p id={explanationId} style={s.explanation}>
          {area.explanation}
        </p>
      )}

      {fileRefs.length > 0 && (
        <ul style={s.fileRefList}>
          {fileRefs.map((ref, i) => {
            const label = `${ref.path}${ref.start_line != null ? `:${ref.start_line}` : ""}`;
            return (
              <li key={`${ref.path}-${i}`}>
                {repoFullName ? (
                  <a
                    href={githubBlobUrl(
                      repoFullName,
                      headSha,
                      ref.path,
                      ref.start_line ?? undefined,
                      ref.end_line ?? undefined,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={s.fileRefLink}
                  >
                    {label}
                  </a>
                ) : (
                  <span style={s.fileRefLink}>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
