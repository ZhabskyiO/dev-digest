/* CiRunsView — /ci-runs (AC-46 … AC-48). Lists CI runs across every
 * installation, filtered by time window / agent / repository / status held
 * in the URL search params (never component state — a shared link or a page
 * refresh reproduces the exact same filtered view). Polls via
 * `useCiRuns(query, { poll: visible })` (R12), and a `refresh_error` on the
 * response renders a non-destructive banner ABOVE the still-rendered rows
 * (AC-45) rather than replacing them with an error screen.
 */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useRepos } from "@/lib/hooks/core";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { useDocumentVisible } from "@/lib/hooks/useDocumentVisible";
import { ApiError } from "@/lib/api";
import type { FilterOption } from "./_components/FiltersBar";
import { FiltersBar } from "./_components/FiltersBar";
import { RunRow } from "./_components/RunRow";
import { COLUMN_KEYS, SKELETON_ROWS } from "./constants";
import { queryFromParams } from "./helpers";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const router = useRouter();
  const searchParams = useSearchParams();
  const visible = useDocumentVisible();

  const query = queryFromParams(searchParams);
  const { data, isLoading, isError, error, refetch } = useCiRuns(query, { poll: visible });
  const refresh = useRefreshCiRuns();
  const { data: agents } = useAgents();
  const { data: repos } = useRepos();

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    const qs = sp.toString();
    router.replace(qs ? `/ci-runs?${qs}` : "/ci-runs");
  }

  const agentOptions: FilterOption[] = (agents ?? []).map((a) => ({ value: a.id, label: a.name }));
  const repoOptions: FilterOption[] = (repos ?? []).map((r) => ({ value: r.full_name, label: r.full_name }));

  const items = data?.items ?? [];
  // `GET /ci-runs` (the `data` above) always returns `refresh_error: null` —
  // only `POST /ci-runs/refresh`'s own response (`refresh.data`, sourced from
  // the mutation, not clobbered by the subsequent cache-invalidated refetch)
  // ever carries the real, server-sanitized reason (server/src/modules/ci/ingest.ts).
  const refreshReason = data?.refresh_error ?? refresh.data?.refresh_error ?? null;
  const refreshFailed = refreshReason != null || refresh.isError;

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.wrap}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.title}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
        </div>

        <div style={s.filtersRow}>
          <FiltersBar
            windowValue={query.window ?? "7d"}
            onWindow={(v) => setParam("window", v)}
            agentId={query.agent_id ?? ""}
            onAgent={(v) => setParam("agent_id", v)}
            agentOptions={agentOptions}
            repo={query.repo ?? ""}
            onRepo={(v) => setParam("repo", v)}
            repoOptions={repoOptions}
            status={query.status ?? ""}
            onStatus={(v) => setParam("status", v)}
            onRefresh={() => refresh.mutate(undefined)}
            refreshing={refresh.isPending}
          />
        </div>

        {refreshFailed && (
          <div role="alert" style={s.banner}>
            <div style={s.bannerHeadline}>
              <Icon.AlertTriangle size={15} />
              <span>{t("runs.refreshFailed")}</span>
            </div>
            {refreshReason && (
              <span style={s.bannerReason}>
                {t("runs.refreshFailedReasonLabel")} {refreshReason}
              </span>
            )}
          </div>
        )}

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
        ) : items.length === 0 ? (
          <div style={s.tableCard}>
            <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
          </div>
        ) : (
          <div style={s.tableCard}>
            <div style={s.headRow}>
              {COLUMN_KEYS.map((key) => (
                <div key={key}>{t(`runs.table.${key}`)}</div>
              ))}
              <div />
            </div>
            {items.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
