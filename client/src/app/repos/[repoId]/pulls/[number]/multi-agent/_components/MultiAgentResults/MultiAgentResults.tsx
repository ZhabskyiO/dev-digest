/* MultiAgentResults — the Multi-Agent Review results view (T18). Resolves
   the route's PR number to the platform's uuid the same way the PR detail
   page does (via the cached `usePulls` list), then reads the PR's live/most-
   recent multi-agent run. Owns the SINGLE `useRunEvents` subscription for
   every currently-running column, so N columns/tabs share one set of
   `EventSource`s and a mid-run mount picks up the server's replay buffer
   without dropping pre-mount events (AC-36). Exactly two modes — Columns and
   Tabs — chosen via `?view=`, so a reload of the same URL keeps the same
   view (AC-32). Renders `DisagreementBlock` in BOTH modes (AC-44). When the
   whole run shares one failure reason, shows ONE run-level banner instead of
   letting every column render its own (AC-38). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { usePulls } from "@/lib/hooks";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useRunEvents } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { AgentColumns } from "../AgentColumns";
import { AgentTabs } from "../AgentTabs";
import { DisagreementBlock } from "../DisagreementBlock";
import RunTraceDrawer from "../../../_components/RunTraceDrawer";
import { ResultsHeader } from "./_components/ResultsHeader";
import { isViewMode, runningRunIds, type ViewMode } from "./helpers";
import { s } from "./styles";

export function MultiAgentResults() {
  const t = useTranslations("runs");
  const tPrReview = useTranslations("prReview");
  const params = useParams<{ repoId: string; number: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { repoId, number } = params;

  const repoNotFound = useRepoNotFound(repoId);
  const { activeRepo } = useActiveRepo();

  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const pr = pulls?.find((p) => p.number === Number(number)) ?? null;
  const prId = pr?.id ?? null;
  const { data: run, isLoading: runLoading, isError, error, refetch } = useMultiAgentRun(prId);

  const requestedView = search.get("view");
  const view: ViewMode = isViewMode(requestedView) ? requestedView : "columns";
  const setView = (mode: ViewMode) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("view", mode);
    router.replace(`/repos/${repoId}/pulls/${number}/multi-agent?${sp.toString()}`);
  };

  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);
  const columns = run?.columns ?? [];
  const liveRunIds = React.useMemo(() => runningRunIds(columns), [columns]);
  const { events } = useRunEvents(liveRunIds);

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: tPrReview("list.breadcrumb"), href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true, href: `/repos/${repoId}/pulls/${number}` },
    { label: t("page.crumb") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const isLoading = pullsLoading || (prId != null && runLoading);
  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.loading}>
            <Skeleton height={28} width={420} />
            <Skeleton height={16} width={300} />
            <Skeleton height={220} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("page.title")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const traceColumn = columns.find((c) => c.run_id === traceRunId) ?? null;
  const hasSharedError = run?.shared_error != null;
  const hasRun = run != null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <ResultsHeader
          pr={pr}
          run={run}
          view={view}
          onSetView={setView}
          onConfigure={() => router.push("/multi-agent")}
        />

        {!hasRun ? (
          <EmptyState
            icon="Users"
            title={t("page.noRun.title")}
            body={prId ? t("page.noRun.bodyReady") : t("page.noRun.bodySelect")}
            cta={t("page.noRun.cta")}
            onCta={() => router.push("/multi-agent")}
          />
        ) : hasSharedError ? (
          <div role="alert" style={s.sharedError}>
            {t("page.results.sharedError", { reason: run?.shared_error ?? "" })}
          </div>
        ) : view === "columns" ? (
          <AgentColumns columns={columns} liveEvents={events} onOpenTrace={setTraceRunId} />
        ) : (
          <AgentTabs
            columns={columns}
            prId={prId ?? ""}
            onOpenTrace={setTraceRunId}
            repoFullName={activeRepo?.full_name ?? null}
            headSha={pr?.head_sha ?? null}
          />
        )}

        {hasRun && <DisagreementBlock conflicts={run?.conflicts ?? []} />}
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr?.number ?? null}
          agentName={traceColumn?.agent_name ?? null}
          findings={(traceColumn?.findings as FindingRecord[] | undefined) ?? []}
          running={traceColumn?.status === "running"}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
