/* ConventionsView — /repos/:repoId/conventions. Runs extraction, lists the
   candidates it grounded against real files, and lets the user accept, reject
   or edit each one. Accepting is what opts a rule into the skill: once at least
   one is accepted, "Create skill" appears next to "Re-scan". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Chip, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ConventionCandidateDetail, ConventionExtractResult } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { SKELETON_ROWS, STATUS_FILTERS, type StatusFilter } from "./constants";
import { acceptedOf, filterByStatus, githubBlobUrl } from "./helpers";
import { s } from "./styles";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: candidates, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);

  const [filter, setFilter] = React.useState<StatusFilter>("pending");
  const [modalOpen, setModalOpen] = React.useState(false);

  const all = candidates ?? [];
  const accepted = acceptedOf(all);
  const visible = filterByStatus(all, filter);
  const repoName = activeRepo?.name ?? activeRepo?.full_name ?? repoId;
  const scan: ConventionExtractResult | undefined = extract.data;

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.content}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.pageTitle}>
              {t("page.headingPrefix")}
              <span style={s.repoName}>{repoName}</span>
            </h1>
            <p style={s.pageSubtitle}>
              {all.length > 0
                ? t("page.acceptedCount", { accepted: accepted.length, total: all.length })
                : t("page.subtitle")}
            </p>
          </div>
          <div style={s.headerActions}>
            <Button kind="secondary" icon="RefreshCw" onClick={() => extract.mutate()} disabled={extract.isPending}>
              {extract.isPending ? t("page.scanning") : all.length > 0 ? t("page.rescan") : t("page.runExtraction")}
            </Button>
            {/* Accepting a rule is the opt-in; nothing to build a skill from until
                at least one candidate has been accepted. */}
            {accepted.length > 0 && (
              <Button kind="primary" icon="Sparkles" onClick={() => setModalOpen(true)}>
                {t("page.createSkill")}
              </Button>
            )}
          </div>
        </div>

        {extract.isError && (
          <div style={s.notice}>
            <Icon.AlertTriangle size={16} style={{ color: "var(--crit)", flexShrink: 0 }} />
            <span>{extract.error instanceof ApiError ? extract.error.message : t("page.extractionFailed")}</span>
          </div>
        )}

        {scan?.degraded && (
          <div style={s.notice}>
            <Icon.Info size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>
              <strong>{t("page.notIndexedTitle")}</strong> — {t("page.notIndexedBody")}
            </span>
          </div>
        )}

        {scan && !scan.degraded && (
          <div style={s.scanSummary}>
            {t("page.scanSummary", {
              kept: scan.candidates.length,
              dropped: scan.dropped,
              duplicates: scan.duplicates
            })}
          </div>
        )}

        {all.length > 0 && (
          <div style={s.filterRow}>
            {STATUS_FILTERS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {t(`filter.${f}`)}
              </Chip>
            ))}
          </div>
        )}

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={140} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : all.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
            ctaLoading={extract.isPending}
          />
        ) : visible.length === 0 ? (
          <EmptyState icon="Filter" title={t("page.emptyFiltered.title")} body={t("page.emptyFiltered.body")} />
        ) : (
          <div style={s.list}>
            {visible.map((c: ConventionCandidateDetail) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                evidenceUrl={githubBlobUrl(activeRepo, c)}
                onStatus={(status) => update.mutate({ id: c.id, patch: { status } })}
                onEdit={(patch) => update.mutate({ id: c.id, patch })}
                busy={update.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {modalOpen && accepted.length > 0 && (
        <CreateSkillModal
          repoId={repoId}
          repoName={repoName}
          candidates={accepted}
          onClose={() => setModalOpen(false)}
          onCreated={() => setModalOpen(false)}
        />
      )}
    </AppShell>
  );
}
