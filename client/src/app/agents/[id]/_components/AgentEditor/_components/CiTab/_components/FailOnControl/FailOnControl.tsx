/* FailOnControl — the CI tab's "Fail CI on" segmented control. Binds directly
 * to `Agent.ci_fail_on` and saves through the SAME `useUpdateAgent` mutation
 * the Config tab uses (one persisted field, two surfaces, AC-5): the PATCH
 * sent carries `ci_fail_on` alone, never a CI-only shadow field. */
"use client";

import { useTranslations } from "next-intl";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { CI_FAIL_ON_VALUES } from "../../../ConfigTab/constants";
import { s } from "../../styles";

export function FailOnControl({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const update = useUpdateAgent();

  const handleSelect = (value: CiFailOn) => {
    if (value === agent.ci_fail_on || update.isPending) return;
    update.mutate({ id: agent.id, patch: { ci_fail_on: value } });
  };

  return (
    <div style={s.failOnCard}>
      <div style={s.failOnLabel}>{t("ciTab.failOn.label")}</div>
      <div role="radiogroup" aria-label={t("ciTab.failOn.label")} style={s.segmented}>
        {CI_FAIL_ON_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={agent.ci_fail_on === value}
            disabled={update.isPending}
            onClick={() => handleSelect(value)}
            style={s.segmentedOption(agent.ci_fail_on === value)}
          >
            {t(`ciTab.failOn.options.${value}`)}
          </button>
        ))}
      </div>
      <p style={s.failOnHint}>{t("ciTab.failOn.hint")}</p>
      <p style={s.branchProtectionNote}>{t("ciTab.branchProtectionNote")}</p>
    </div>
  );
}
