"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon, TextInput } from "@devdigest/ui";
import { REPO_PATTERN, TARGET_OPTIONS } from "../../constants";
import type { WizardAction, WizardState } from "../../reducer";

/** Step 1 — pick the CI target (only GitHub Actions is selectable, AC-11)
 *  and the target `owner/name` repository (AC-10). */
export function StepTarget({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const t = useTranslations("ci");
  const showInvalid = state.repo.length > 0 && !REPO_PATTERN.test(state.repo);

  return (
    <div>
      <div
        role="radiogroup"
        aria-label={t("exportWizard.targetGroupLabel")}
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}
      >
        {TARGET_OPTIONS.map((opt) => {
          const selected = opt.value === "gha";
          const I = Icon[opt.icon];
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={opt.disabled}
              disabled={opt.disabled}
              // The other three targets are visibly disabled and unselectable
              // (AC-11) — nothing to wire even if a stray click got through.
              onClick={() => undefined}
              style={{
                textAlign: "left",
                border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
                borderRadius: 8,
                padding: 16,
                background: "var(--bg-elevated)",
                opacity: opt.disabled ? 0.55 : 1,
                cursor: opt.disabled ? "not-allowed" : "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <I size={18} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{t(`exportWizard.targets.${opt.value}`)}</span>
                {opt.value === "gha" && (
                  <Badge bg="var(--accent-bg)" color="var(--accent-text)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
                {opt.disabled && <Badge>{t("exportWizard.comingSoon")}</Badge>}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t(`exportWizard.targets.${opt.value}Desc`)}
              </div>
            </button>
          );
        })}
      </div>
      <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
        <TextInput
          value={state.repo}
          onChange={(v) => dispatch({ type: "SET_REPO", repo: v })}
          placeholder={t("exportWizard.repoPlaceholder")}
        />
      </FormField>
      {showInvalid && (
        <p role="alert" style={{ fontSize: 13, color: "var(--crit)", marginTop: -12 }}>
          {t("exportWizard.repoInvalid")}
        </p>
      )}
    </div>
  );
}
