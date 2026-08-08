/* IntentCard — the Intent Layer's derived intent for a PR (title/body/branch/
   commits/paths → a structured claim about what the PR is for), rendered on
   the Overview tab. `data` is a CLAIM produced by a separate, cheap model —
   never presented as fact (see `intent.claimNote` and the confidence chip).

   Early-return states, in order: loading → skeleton; error → an inline error
   (never full-screen — the Description section below must still render);
   `data == null` → "not derived yet" (the normal state for any PR that has
   never been reviewed); `data` → the card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Chip, ConfidenceNum, Skeleton, Icon, Button } from "@devdigest/ui";
import { usePrIntent } from "@/lib/hooks/reviews";
import { s } from "./styles";

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const tCommon = useTranslations("common");
  const { data, isLoading, isError, refetch } = usePrIntent(prId);

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
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <div style={s.unavailableBox}>
          <div style={s.unavailableTitle}>{t("unavailable")}</div>
          <div style={s.unavailableHint}>{t("unavailableHint")}</div>
        </div>
      </section>
    );
  }

  const tier = data.confidence.tier;
  const hasInScope = data.in_scope.length > 0;
  const hasOutOfScope = data.out_of_scope.length > 0;
  /* At `low` confidence the prompt builder omits both scope lists from the
     reviewer's prompt, but they are still persisted and shown here. Say so,
     or the card implies the review was informed by them. */
  const scopeWithheldFromReviewer = tier === "low" && (hasInScope || hasOutOfScope);

  return (
    <section style={s.section}>
      <SectionLabel
        icon="Target"
        right={
          <div style={s.confidenceWrap} title={t(`intent.confidenceHint.${tier}`)}>
            <Chip>{t(`intent.confidence.${tier}`)}</Chip>
            <ConfidenceNum value={data.confidence.score} />
          </div>
        }
      >
        {t("block.intent")}
      </SectionLabel>

      <div style={s.box}>
        <blockquote style={s.statement}>{data.intent}</blockquote>
        <p style={s.claimNote}>{t("intent.claimNote")}</p>

        {(hasInScope || hasOutOfScope) && (
          <div style={s.scopeGrid}>
            {hasInScope && (
              <div style={s.scopeBlock}>
                <div style={s.scopeLabel}>
                  <Icon.Check size={13} style={{ color: "var(--ok)" }} aria-hidden="true" />
                  {t("intent.inScope")}
                </div>
                <ul style={s.scopeList}>
                  {data.in_scope.map((item, i) => (
                    <li key={`${i}-${item}`} style={s.scopeItem}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasOutOfScope && (
              <div style={s.scopeBlock}>
                <div style={s.scopeLabel}>
                  <Icon.X size={13} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
                  {t("intent.outOfScope")}
                </div>
                <ul style={s.scopeList}>
                  {data.out_of_scope.map((item, i) => (
                    <li key={`${i}-${item}`} style={s.scopeItem}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
