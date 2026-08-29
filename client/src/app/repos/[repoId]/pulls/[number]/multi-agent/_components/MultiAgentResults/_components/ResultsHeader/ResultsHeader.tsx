/* ResultsHeader — pull request + run meta (AC-46), the Columns/Tabs mode
   switch (AC-32; a two-button group, natively keyboard-operable, its
   selected state exposed via `aria-pressed` for assistive tech per WCAG 2.1
   AA), and the link back to the Configure-run page. */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { MultiAgentRun, PrMeta } from "@devdigest/shared";
import { formatCostUsd } from "@/lib/format";
import { VIEW_MODES, VIEW_MODE_LABEL_KEY, metaDurationSec, type ViewMode } from "../../helpers";
import { s } from "../../styles";

export interface ResultsHeaderProps {
  pr: PrMeta | null;
  run: MultiAgentRun | null | undefined;
  view: ViewMode;
  onSetView: (mode: ViewMode) => void;
  onConfigure: () => void;
}

export function ResultsHeader({ pr, run, view, onSetView, onConfigure }: ResultsHeaderProps) {
  const t = useTranslations("runs");

  return (
    <div style={s.header}>
      <div style={s.headerTitles}>
        <h1 style={s.title}>
          {pr ? t("page.results.header", { number: pr.number, title: pr.title }) : t("page.title")}
        </h1>
        {run && (
          <p style={s.meta}>
            {t("page.meta", {
              count: run.agent_count,
              duration: metaDurationSec(run.total_duration_ms),
              cost: formatCostUsd(run.total_cost_usd),
            })}
          </p>
        )}
      </div>

      <div style={s.headerActions}>
        <div style={s.viewToggle} role="group">
          {VIEW_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              kind="tertiary"
              size="sm"
              active={view === mode}
              aria-pressed={view === mode}
              onClick={() => onSetView(mode)}
            >
              {t(`page.results.${VIEW_MODE_LABEL_KEY[mode]}`)}
            </Button>
          ))}
        </div>
        <Button type="button" kind="secondary" size="sm" onClick={onConfigure}>
          {t("page.noRun.cta")}
        </Button>
      </div>
    </div>
  );
}
