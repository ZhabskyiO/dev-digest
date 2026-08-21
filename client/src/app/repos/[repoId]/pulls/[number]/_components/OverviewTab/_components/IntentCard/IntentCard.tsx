/* IntentCard — the Intent Layer's derived intent for a PR (title/body/branch/
   commits/paths → a structured claim about what the PR is for), rendered on
   the Overview tab. `intent` is a CLAIM produced by a separate, cheap model,
   not a review finding: the quote is typeset in quotation marks and risk
   areas are named as places to look, never as verdicts.

   Purely presentational: the parent `BriefCard` owns fetching, loading, and
   error states, and the one token-spending control for the whole brief (see
   AC-43 — the intent block itself carries no recalculate action). The only
   early-return state left here is `intent == null` — "not derived yet", the
   normal state for any PR that has never been reviewed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Icon } from "@devdigest/ui";
import type { PrIntentDetail } from "@devdigest/shared";
import { RiskAreas } from "./_components/RiskAreas";
import { s } from "./styles";

export function IntentCard({
  intent,
  repoFullName,
  headSha,
}: {
  intent: PrIntentDetail | null;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("brief");

  if (intent == null) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <div style={s.unavailableBox}>
          <div style={s.unavailableTitle}>{t("unavailable")}</div>
          <div style={s.unavailableHint}>{t("unavailableHint")}</div>
        </div>
      </section>
    );
  }

  const tier = intent.confidence.tier;
  const hasInScope = intent.in_scope.length > 0;
  const hasOutOfScope = intent.out_of_scope.length > 0;
  /* At `low` confidence the prompt builder omits both scope lists from the
     reviewer's prompt, but they are still persisted and shown here. Say so,
     or the card implies the review was informed by them. */
  const scopeWithheldFromReviewer = tier === "low" && (hasInScope || hasOutOfScope);

  return (
    <section style={s.section}>
      <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>

      <div style={s.box}>
        {/* The quotation marks are content, not decoration: they mark the
            sentence as the PR author's claim as read by the model. */}
        <blockquote style={s.statement}>&ldquo;{intent.intent}&rdquo;</blockquote>

        {(hasInScope || hasOutOfScope) && (
          <div style={s.scopeGrid}>
            {hasInScope && (
              <div style={s.scopeBlock}>
                <div style={{ ...s.scopeLabel, color: "var(--ok)" }}>
                  <Icon.Check size={15} aria-hidden="true" />
                  {t("intent.inScope")}
                </div>
                <ScopeList items={intent.in_scope} />
              </div>
            )}

            {hasOutOfScope && (
              <div style={s.scopeBlock}>
                <div style={s.scopeLabel}>
                  <Icon.X size={15} aria-hidden="true" />
                  {t("intent.outOfScope")}
                </div>
                <ScopeList items={intent.out_of_scope} />
              </div>
            )}
          </div>
        )}

        <RiskAreas areas={intent.risk_areas} repoFullName={repoFullName} headSha={headSha} />

        {scopeWithheldFromReviewer && (
          <p style={s.notPromptedNote}>
            <Icon.AlertTriangle
              size={13}
              style={{ flexShrink: 0, marginTop: 2 }}
              aria-hidden="true"
            />
            {t("intent.scopeNotPrompted")}
          </p>
        )}
      </div>
    </section>
  );
}

/* Scope items use an explicit `·` span rather than a list marker: the design's
   bullet is dimmer than its label and `::marker` can't be reached from an
   inline style object. `listStyle: none` is therefore mandatory here. */
function ScopeList({ items }: { items: string[] }) {
  return (
    <ul style={s.scopeList}>
      {items.map((item, i) => (
        <li key={`${i}-${item}`} style={s.scopeItem}>
          <span style={s.scopeBullet} aria-hidden="true">
            ·
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
