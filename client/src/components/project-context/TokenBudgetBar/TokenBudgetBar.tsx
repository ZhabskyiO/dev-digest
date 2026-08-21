/* TokenBudgetBar — the effective context set's token total against the
   configured project-context budget (AC-40), used by both the agent Context
   tab and the skill's "Project context to use" section.

   Purely advisory (AC-41): going over budget never disables attaching,
   saving, or running here — this component renders no disabled control and
   exposes no `disabled` prop for its callers to misuse for that purpose. The
   over-budget state names the tail documents AC-23 would drop at run time,
   in the same order, so the warning matches what actually happens. */
"use client";

import { useTranslations } from "next-intl";
import { Icon, ProgressBar } from "@devdigest/ui";
import { s } from "./styles";

export function TokenBudgetBar({
  totalTokens,
  budgetTokens,
  overBudget,
  droppedPaths,
}: {
  totalTokens: number;
  budgetTokens: number;
  /** Whether `totalTokens` exceeds `budgetTokens` (AC-40). */
  overBudget: boolean;
  /** Ordered tail of paths that would not be injected under the current
   *  budget (AC-40) — same order AC-23's run-time drop produces. */
  droppedPaths: string[];
}) {
  const t = useTranslations("context");
  const pct = budgetTokens > 0 ? (totalTokens / budgetTokens) * 100 : 0;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span className="tnum" style={s.total}>
          {t("budget.approx", { total: totalTokens, budget: budgetTokens })}
        </span>
        {!overBudget && <span style={s.advisory}>{t("budget.advisory")}</span>}
      </div>
      <ProgressBar value={pct} color={overBudget ? "var(--warn)" : "var(--accent)"} />
      {overBudget && (
        <div style={s.overBudget}>
          <div style={s.overBudgetHead}>
            <Icon.AlertTriangle size={13} />
            {t("budget.willDrop")}
          </div>
          <div style={s.droppedList}>
            {droppedPaths.map((path) => (
              <span key={path} className="mono" style={s.droppedPath}>
                {path}
              </span>
            ))}
          </div>
          <span style={s.advisory}>{t("budget.advisory")}</span>
        </div>
      )}
    </div>
  );
}
