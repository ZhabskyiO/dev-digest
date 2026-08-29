/* RunRow — one row of the CI Runs table: the six columns (timestamp, PR,
 * source, findings, cost, status) plus a per-row link to the GitHub run
 * (AC-46). Status is conveyed by an icon + translated text pill, never by
 * colour alone (AC-41) — `StatusPill`'s accessible name is that same text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { CiRunListItem, CiRunStatus } from "@devdigest/shared";
import { formatCostUsd } from "@/lib/format";
import { safeGithubUrl } from "@/lib/safeUrl";
import { STATUS_LABEL_KEY, STATUS_META, UNKNOWN_STATUS_META } from "../../constants";
import { formatTimestamp } from "../../helpers";
import { s } from "../../styles";

function isKnownStatus(status: string | null): status is CiRunStatus {
  return !!status && status in STATUS_META;
}

/** `source` mirrors `CiInstallation.target_type` when set to one of the known
 *  CI targets — translate it through `exportWizard.targets.*` for a friendly
 *  label ("GitHub Actions") and fall back to the raw value otherwise, since
 *  the contract only types it as a loose nullable string. */
const CI_TARGETS = ["gha", "circle", "jenkins", "cli"] as const;

function useSourceLabel(source: string | null): string {
  const t = useTranslations("ci");
  if (!source) return "—";
  return (CI_TARGETS as readonly string[]).includes(source)
    ? t(`exportWizard.targets.${source}`)
    : source;
}

function StatusPill({ status }: { status: string | null }) {
  const t = useTranslations("ci");
  const known = isKnownStatus(status);
  const meta = known ? STATUS_META[status] : UNKNOWN_STATUS_META;
  const label = known ? t(`runs.status.${STATUS_LABEL_KEY[status]}`) : "—";
  const I = Icon[meta.icon];
  return (
    <span style={s.statusPill(meta.color, meta.bg)}>
      <I size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

export function RunRow({ run }: { run: CiRunListItem }) {
  const t = useTranslations("ci");
  const sourceLabel = useSourceLabel(run.source);
  const githubUrl = safeGithubUrl(run.github_url);
  return (
    <div style={s.row}>
      <span className="mono">{formatTimestamp(run.ran_at)}</span>
      <span className="mono">{run.pr_number != null ? `#${run.pr_number}` : "—"}</span>
      <span>{sourceLabel}</span>
      <span className="tnum">{run.findings_count ?? "—"}</span>
      <span className="tnum">{formatCostUsd(run.cost_usd)}</span>
      <StatusPill status={run.status} />
      {githubUrl ? (
        <a href={githubUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
          {t("runs.view")}
        </a>
      ) : (
        <span style={s.muted}>—</span>
      )}
    </div>
  );
}
