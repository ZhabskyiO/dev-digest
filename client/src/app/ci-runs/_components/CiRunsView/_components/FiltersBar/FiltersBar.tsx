/* FiltersBar — the CI Runs page's four filter controls (time window, agent,
 * repository, status) plus the manual Refresh button. Each control writes
 * straight back to the URL via its `onChange`; the view owns reading/writing
 * search params so this stays a plain controlled-select presentational
 * component with no state of its own.
 *
 * `SelectInput` from @devdigest/ui has no `aria-label` passthrough, so a
 * bare native `<select>` is used here instead — required to give each filter
 * an accessible name (react-best-practices: label every form control). The
 * catalogue (client/messages/en/ci.json) has no dedicated "filter by X"
 * label key per control, only each select's own default/"all" option text —
 * that text doubles as the control's aria-label. See this task's final
 * report for the follow-up (a `filters.windowLabel`/`agentLabel`/… key set
 * would describe the control itself regardless of the current selection).
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { CiRunStatus } from "@devdigest/shared";
import { STATUS_LABEL_KEY, STATUS_VALUES, WINDOW_VALUES } from "../../constants";

export interface FilterOption {
  value: string;
  label: string;
}

function FilterSelect({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 7,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-elevated)",
      }}
    >
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 13,
          color: "var(--text-primary)",
          background: "transparent",
          border: "none",
          outline: "none",
          appearance: "none",
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon.ChevronsUpDown size={13} style={{ color: "var(--text-muted)", pointerEvents: "none" }} />
    </div>
  );
}

export function FiltersBar({
  windowValue,
  onWindow,
  agentId,
  onAgent,
  agentOptions,
  repo,
  onRepo,
  repoOptions,
  status,
  onStatus,
  onRefresh,
  refreshing,
}: {
  windowValue: string;
  onWindow: (v: string) => void;
  agentId: string;
  onAgent: (v: string) => void;
  agentOptions: FilterOption[];
  repo: string;
  onRepo: (v: string) => void;
  repoOptions: FilterOption[];
  status: string;
  onStatus: (v: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations("ci");

  const windowOptions: FilterOption[] = WINDOW_VALUES.map((v) => ({
    value: v,
    label: v === "7d" ? t("runs.filters.last7Days") : v,
  }));
  const statusOptions: FilterOption[] = [
    { value: "", label: t("runs.filters.allStatuses") },
    ...STATUS_VALUES.map((value: CiRunStatus) => ({
      value,
      label: t(`runs.filters.status.${STATUS_LABEL_KEY[value]}`),
    })),
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <FilterSelect
        ariaLabel={t("runs.filters.last7Days")}
        value={windowValue}
        onChange={onWindow}
        options={windowOptions}
      />
      <FilterSelect
        ariaLabel={t("runs.filters.allAgents")}
        value={agentId}
        onChange={onAgent}
        options={[{ value: "", label: t("runs.filters.allAgents") }, ...agentOptions]}
      />
      <FilterSelect
        ariaLabel={t("runs.filters.allRepos")}
        value={repo}
        onChange={onRepo}
        options={[{ value: "", label: t("runs.filters.allRepos") }, ...repoOptions]}
      />
      <FilterSelect
        ariaLabel={t("runs.filters.allStatuses")}
        value={status}
        onChange={onStatus}
        options={statusOptions}
      />
      <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? t("runs.refreshing") : t("runs.refresh")}
      </Button>
    </div>
  );
}
