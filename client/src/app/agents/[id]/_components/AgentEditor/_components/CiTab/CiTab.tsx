/* CiTab — the agent's CI deployment surface: the "Active in N repos" badge
 * (AC-3), the deployment table or empty state (AC-2, AC-4), the shared
 * `ci_fail_on` gate control (AC-5, AC-6, AC-7), and the export action that
 * mounts the sibling `ExportWizard`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCiInstallations } from "@/lib/hooks/ci";
import { useDocumentVisible } from "@/lib/hooks/useDocumentVisible";
import { ExportWizard } from "../ExportWizard";
import { FailOnControl } from "./_components/FailOnControl";
import { InstallationRow } from "./_components/InstallationRow";
import { countDistinctRepos } from "./helpers";
import { s } from "./styles";

/** Rows of skeleton placeholder while the first fetch is in flight — kept
 *  local rather than importing `CiRunsView/constants.ts`'s own count across
 *  a sibling task's owned paths (client/insights/gotchas.md, 2026-08-27). */
const SKELETON_ROWS = 3;

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const visible = useDocumentVisible();
  const { data, isLoading, isError, error, refetch } = useCiInstallations(agent.id, { poll: visible });
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const rows = data ?? [];
  const hasInstallations = rows.length > 0;
  const repoCount = countDistinctRepos(rows);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>{t("ciTab.heading")}</h2>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          {repoCount > 0 && (
            <Badge color="var(--ok)" bg="var(--ok-bg)" icon="CheckCircle">
              {t("ciTab.activeIn", { count: repoCount })}
            </Badge>
          )}
          {hasInstallations && (
            <Button kind="primary" icon="Plus" onClick={() => setWizardOpen(true)}>
              {t("ciTab.exportToCi")}
            </Button>
          )}
        </div>
      </div>

      <FailOnControl agent={agent} />

      {isLoading ? (
        <div style={s.tableCard}>
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        </div>
      ) : isError ? (
        <ErrorState
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : hasInstallations ? (
        <div style={s.tableCard}>
          <div style={s.headRow}>
            <span>{t("ciTab.table.repo")}</span>
            <span>{t("ciTab.table.target")}</span>
            <span>{t("ciTab.table.status")}</span>
            <span>{t("ciTab.table.lastRun")}</span>
            <span />
          </div>
          {rows.map((row) => (
            <InstallationRow key={row.installation.id} agentId={agent.id} status={row} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="Workflow"
          title={t("ciTab.emptyTitle")}
          body={t("ciTab.emptyBody")}
          cta={t("ciTab.exportToCi")}
          onCta={() => setWizardOpen(true)}
        />
      )}

      <ExportWizard agent={agent} open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
