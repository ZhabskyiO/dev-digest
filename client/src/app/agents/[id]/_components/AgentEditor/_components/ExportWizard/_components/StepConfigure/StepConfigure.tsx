"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { CiPostAs } from "@devdigest/shared";
import { LLM_SECRET_NAME, POST_AS_LABEL_KEY, POST_AS_OPTIONS, TRIGGER_OPTIONS } from "../../constants";
import type { WizardAction, WizardState } from "../../reducer";

/** Step 3 — triggers (non-empty, AC-20), post destination (default
 *  `github_review`, AC-21), branch-protection guidance (AC-23), and the
 *  secret-name note distinguishing the LLM key from the automatic token
 *  (AC-24). */
export function StepConfigure({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{t("exportWizard.triggerLabel")}</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {TRIGGER_OPTIONS.map((trig) => (
            <Checkbox
              key={trig}
              checked={state.triggers.includes(trig)}
              onChange={() => dispatch({ type: "TOGGLE_TRIGGER", trigger: trig })}
              label={`pull_request:${trig}`}
            />
          ))}
        </div>
        {state.triggers.length === 0 && (
          <p role="alert" style={{ fontSize: 13, color: "var(--crit)", marginTop: 8 }}>
            {t("exportWizard.triggersRequired")}
          </p>
        )}
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{t("exportWizard.postResultsLabel")}</div>
        <div
          role="radiogroup"
          aria-label={t("exportWizard.postResultsLabel")}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {POST_AS_OPTIONS.map((opt) => (
            <label key={opt} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
              <input
                type="radio"
                name="ci-post-as"
                checked={state.postAs === opt}
                onChange={() => dispatch({ type: "SET_POST_AS", postAs: opt as CiPostAs })}
              />
              {t(`exportWizard.postAs.${POST_AS_LABEL_KEY[opt]}`)}
              {opt === "github_review" && <Badge>{t("exportWizard.recommended")}</Badge>}
            </label>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          padding: 14,
          borderRadius: 8,
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
        }}
      >
        <Icon.Info size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          <strong>{t("exportWizard.blockMergeTitle")}</strong>
          <div>{t("exportWizard.blockMergeDesc")}</div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {t("exportWizard.secretNoteAuto", { key: LLM_SECRET_NAME })}
      </p>
    </div>
  );
}
