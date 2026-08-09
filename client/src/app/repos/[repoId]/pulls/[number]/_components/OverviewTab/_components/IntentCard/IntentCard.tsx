/* IntentCard — the Intent Layer's derived intent for a PR (title/body/branch/
   commits/paths → a structured claim about what the PR is for), rendered on
   the Overview tab. `data` is a CLAIM produced by a separate, cheap model, not
   a review finding: the quote is typeset in quotation marks and risk areas are
   named as places to look, never as verdicts.

   Early-return states, in order: loading → skeleton; error → an inline error
   (never full-screen — the Description section below must still render);
   `data == null` → "not derived yet" (the normal state for any PR that has
   never been reviewed); `data` → the card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Skeleton, Icon, Button } from "@devdigest/ui";
import type { RiskAreaKind } from "@devdigest/shared";
import { usePrIntent, useRecalculateIntent } from "@/lib/hooks/reviews";
import { s } from "./styles";

/* One icon + accent per `RiskAreaKind`. Exhaustive by construction: the record
   is keyed by the union, so widening `RiskAreaKind` in the shared contract
   fails typecheck here until an icon is chosen — which is exactly why that
   enum is closed (see contracts/brief.ts). */
const RISK_AREA_STYLE: Record<
  RiskAreaKind,
  { icon: keyof typeof Icon; color: string }
> = {
  security: { icon: "Shield", color: "var(--crit)" },
  dependency: { icon: "Boxes", color: "var(--warn)" },
  performance: { icon: "Zap", color: "var(--sugg)" },
  data: { icon: "Database", color: "var(--accent)" },
  breaking: { icon: "AlertTriangle", color: "var(--crit)" },
  other: { icon: "Info", color: "var(--text-muted)" },
};

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const tCommon = useTranslations("common");
  const { data, isLoading, isError, refetch } = usePrIntent(prId);
  const recalculate = useRecalculateIntent(prId);

  /* Unlike the retry button in the error state, this one SPENDS TOKENS: it is
     the manual trigger for a fresh derivation, not a refetch. Hence the
     distinct label, the pending state, and `disabled` while in flight — a
     second click within the same derivation is deduped server-side, but the
     UI should not invite it. */
  const recalcButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      disabled={prId == null || recalculate.isPending}
      onClick={() => recalculate.mutate()}
    >
      {recalculate.isPending ? t("intent.recalculating") : t("intent.recalculate")}
    </Button>
  );

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <div style={s.skeletonWrap}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={48} />
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <div role="alert" style={s.errorBox}>
          <div style={s.errorLeft}>
            <Icon.AlertTriangle size={15} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{t("intent.error")}</span>
          </div>
          {/* The GET failed, so a plain refetch is the right first move here —
              re-deriving would spend tokens to fix what may be a transport blip. */}
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {tCommon("actions.retry")}
          </Button>
        </div>
      </section>
    );
  }

  if (data == null) {
    return (
      <section style={s.section}>
        {/* The one state where this button is the only way out: without it,
            leaving "not derived yet" requires running a whole review. */}
        <SectionLabel icon="Target" right={recalcButton}>
          {t("block.intent")}
        </SectionLabel>
        <div style={s.unavailableBox}>
          <div style={s.unavailableTitle}>{t("unavailable")}</div>
          <div style={s.unavailableHint}>{t("unavailableHint")}</div>
        </div>
        {recalculate.isError && (
          <p role="alert" style={s.recalcError}>
            {t("intent.recalculateFailed")}
          </p>
        )}
      </section>
    );
  }

  const tier = data.confidence.tier;
  const hasInScope = data.in_scope.length > 0;
  const hasOutOfScope = data.out_of_scope.length > 0;
  const hasRiskAreas = data.risk_areas.length > 0;
  /* At `low` confidence the prompt builder omits both scope lists from the
     reviewer's prompt, but they are still persisted and shown here. Say so,
     or the card implies the review was informed by them. */
  const scopeWithheldFromReviewer = tier === "low" && (hasInScope || hasOutOfScope);

  return (
    <section style={s.section}>
      <SectionLabel icon="Target" right={recalcButton}>
        {t("block.intent")}
      </SectionLabel>

      {recalculate.isError && (
        <p role="alert" style={s.recalcError}>
          {t("intent.recalculateFailed")}
        </p>
      )}

      <div style={s.box}>
        {/* The quotation marks are content, not decoration: they mark the
            sentence as the PR author's claim as read by the model. */}
        <blockquote style={s.statement}>&ldquo;{data.intent}&rdquo;</blockquote>

        {(hasInScope || hasOutOfScope) && (
          <div style={s.scopeGrid}>
            {hasInScope && (
              <div style={s.scopeBlock}>
                <div style={{ ...s.scopeLabel, color: "var(--ok)" }}>
                  <Icon.Check size={15} aria-hidden="true" />
                  {t("intent.inScope")}
                </div>
                <ScopeList items={data.in_scope} />
              </div>
            )}

            {hasOutOfScope && (
              <div style={s.scopeBlock}>
                <div style={s.scopeLabel}>
                  <Icon.X size={15} aria-hidden="true" />
                  {t("intent.outOfScope")}
                </div>
                <ScopeList items={data.out_of_scope} />
              </div>
            )}
          </div>
        )}

        {hasRiskAreas && (
          <div style={s.riskSection}>
            <div style={s.scopeLabel}>
              <Icon.AlertTriangle size={15} aria-hidden="true" />
              {t("intent.riskAreas")}
            </div>
            <ul style={s.riskChips}>
              {data.risk_areas.map((area, i) => {
                const style = RISK_AREA_STYLE[area.kind];
                const Glyph = Icon[style.icon];
                return (
                  <li key={`${i}-${area.label}`} style={s.riskChip}>
                    <Glyph size={15} style={{ color: style.color, flexShrink: 0 }} aria-hidden="true" />
                    {area.label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
