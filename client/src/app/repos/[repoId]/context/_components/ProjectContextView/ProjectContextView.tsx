/* ProjectContextView — /repos/:repoId/context. Browses the specs/docs/insights
   markdown DevDigest discovered under the repo's clone: filter, select a
   document to preview it read-only, and trigger a rescan (which fetches
   origin/<defaultBranch> into the clone first, so documents pushed after the
   repo was imported appear — the page itself only ever reads the checkout). Attaching a
   document to an agent or a skill happens on their own Context screens
   (client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab,
   client/src/app/skills/_components/SkillDetail/_components/ContextTab) — this
   page is browse-only with respect to document *content* (no mutation of
   files in the clone — no add, no rename, no in-place content changes), so
   it renders no checkbox/attach affordance.
   It IS interactive with respect to drift (AC-37, AC-38): each document
   carries `drifted_for`, naming every agent/skill it has drifted for, and
   clicking one opens the before/after comparison and lets the user confirm —
   confirming writes only DevDigest's own attachment metadata, never the
   clone, so it doesn't breach the content-read-only boundary. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, IconBtn, Skeleton } from "@devdigest/ui";
import type { ProjectContextDriftOwner } from "@devdigest/shared";
import { DocumentFilter, DocumentPreview, DriftBadge, DriftCompare } from "@/components/project-context";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import {
  useProjectContextDocuments,
  useRescanProjectContext,
  useDocumentPreview,
  useDocumentDrift,
  useConfirmDrift,
  type ProjectContextOwnerKind,
} from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { DOC_TYPE_ORDER, SKELETON_ROWS, TYPE_COLOR } from "./constants";
import { filterDocuments, formatSize, groupByType, joinList, splitPath } from "./helpers";
import { s } from "./styles";

/** Which drift detail is open — resolved from whichever owner chip on a
 *  document row was clicked (a document can be drifted for several owners
 *  at once, so the target names exactly one). */
interface DriftTarget {
  ownerKind: ProjectContextOwnerKind;
  ownerId: string;
  ownerName: string;
  path: string;
}

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useProjectContextDocuments(repoId);
  const rescan = useRescanProjectContext(repoId);

  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const preview = useDocumentPreview(repoId, selectedPath);

  // Drift detail (AC-37, AC-38).
  const [driftTarget, setDriftTarget] = React.useState<DriftTarget | null>(null);
  const { data: driftDetail, isLoading: driftLoading } = useDocumentDrift(
    repoId,
    driftTarget?.ownerKind,
    driftTarget?.ownerId,
    driftTarget?.path,
  );
  const confirmDrift = useConfirmDrift();

  const openDrift = (path: string, owner: ProjectContextDriftOwner) => {
    setDriftTarget({ ownerKind: owner.owner_kind, ownerId: owner.owner_id, ownerName: owner.owner_name, path });
  };
  const handleConfirmDrift = () => {
    if (!driftTarget) return;
    confirmDrift.mutate(
      { repoId, ownerKind: driftTarget.ownerKind, ownerId: driftTarget.ownerId, path: driftTarget.path },
      { onSuccess: () => setDriftTarget(null) },
    );
  };

  const repoName = activeRepo?.full_name ?? activeRepo?.name ?? repoId;
  const crumb = [{ label: repoName }, { label: t("page.crumb") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const documents = data?.documents ?? [];
  const notCloned = data?.reason === "not_cloned";
  const noDocuments = !notCloned && data != null && documents.length === 0;
  const visible = filterDocuments(documents, filter);
  const groups = groupByType(visible);
  const hasOmissions = data?.omitted != null && (data.omitted.by_count > 0 || data.omitted.by_size > 0);

  return (
    <AppShell crumb={crumb}>
      <div style={s.content}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.pageTitle}>{t("page.title")}</h1>
            <p style={s.pageSubtitle}>
              {data?.scanned_at ? t("page.scannedAt", { time: new Date(data.scanned_at).toLocaleString() }) : t("page.subtitle")}
              {/* Which revision produced this list. Without it an empty page is
                  indistinguishable from a clone that predates the folders the
                  user is looking for. */}
              {data?.clone_head ? ` · ${t("page.atRevision", { sha: data.clone_head.slice(0, 7) })}` : ""}
            </p>
          </div>
          <div style={s.headerActions}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={() => rescan.mutate()}
              disabled={rescan.isPending || isLoading}
            >
              {rescan.isPending ? t("page.rescanning") : t("page.rescan")}
            </Button>
          </div>
        </div>

        {data?.sync_error && (
          <div style={s.notice}>
            <span>
              <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", marginRight: 6, verticalAlign: -2 }} />
              {t("page.syncFailed", { reason: data.sync_error })}
            </span>
          </div>
        )}

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={36} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : notCloned ? (
          <EmptyState icon="GitBranch" title={t("page.empty.notCloned.title")} body={t("page.empty.notCloned.body")} />
        ) : noDocuments ? (
          <EmptyState
            icon="FileText"
            title={t("page.empty.noDocuments.title")}
            body={t("page.empty.noDocuments.body", {
              roots: joinList(data?.roots ?? []),
              filenames: joinList(data?.conventional_filenames ?? []),
              repo: repoName,
            })}
          />
        ) : (
          <>
            {hasOmissions && data?.omitted && (
              <div style={s.notice}>
                {data.omitted.by_count > 0 && (
                  <span>
                    <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", marginRight: 6, verticalAlign: -2 }} />
                    {t("page.omitted.byCount", { count: data.omitted.by_count })}
                  </span>
                )}
                {data.omitted.by_size > 0 && (
                  <span>
                    <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", marginRight: 6, verticalAlign: -2 }} />
                    {t("page.omitted.bySize", { count: data.omitted.by_size })}
                  </span>
                )}
              </div>
            )}

            <div style={s.layout}>
              <div style={s.listPane}>
                <DocumentFilter value={filter} onChange={setFilter} />
                <div style={s.groups}>
                  {DOC_TYPE_ORDER.map((type) => {
                    const items = groups[type];
                    if (items.length === 0) return null;
                    return (
                      <div key={type}>
                        <div style={s.groupHeading}>{t(`docType.${type}`)}</div>
                        <div style={s.groupList} role="list">
                          {items.map((doc) => {
                            const { name, dir } = splitPath(doc.path);
                            const size = formatSize(doc.size_bytes);
                            const selected = doc.path === selectedPath;
                            const driftedFor = doc.drifted_for ?? [];
                            return (
                              <div key={doc.path} role="listitem" style={s.row(selected)}>
                                <button
                                  type="button"
                                  aria-current={selected}
                                  onClick={() => setSelectedPath(doc.path)}
                                  style={s.rowSelectBtn}
                                >
                                  <div style={s.rowTop}>
                                    <span style={s.rowName}>{name}</span>
                                    {dir && <span style={s.rowDir}>{dir}</span>}
                                    {driftedFor.length > 0 && <DriftBadge />}
                                    <span style={{ marginLeft: "auto" }} />
                                    <span style={{ color: TYPE_COLOR[doc.type], fontSize: 11, fontWeight: 600 }}>
                                      {t(`docType.${doc.type}`)}
                                    </span>
                                  </div>
                                  <div style={s.rowMeta}>
                                    <span className="tnum">{t(size.key, { count: size.count })}</span>
                                    <span>·</span>
                                    <span className="tnum">{t("tokens.approx", { count: doc.tokens })}</span>
                                    {doc.used_by_agents > 0 && (
                                      <>
                                        <span>·</span>
                                        <span>{t("attachments.usedByAgents", { count: doc.used_by_agents })}</span>
                                      </>
                                    )}
                                  </div>
                                </button>
                                {driftedFor.length > 0 && (
                                  <div style={s.driftOwners}>
                                    <span style={s.driftOwnersLabel}>{t("drift.driftedForLabel")}</span>
                                    {driftedFor.map((owner: ProjectContextDriftOwner) => (
                                      <button
                                        key={`${owner.owner_kind}-${owner.owner_id}`}
                                        type="button"
                                        onClick={() => openDrift(doc.path, owner)}
                                        style={s.driftOwnerBtn}
                                      >
                                        {owner.owner_name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {visible.length === 0 && <div style={s.rowMeta}>{t("attachments.empty")}</div>}
                </div>
              </div>

              <div style={s.previewPane}>
                {driftTarget ? (
                  <div style={s.driftPanel}>
                    <div style={s.driftPanelHeader}>
                      <span style={s.driftPanelTitle}>{t("drift.detail.title")}</span>
                      <IconBtn icon="X" label={t("drift.detail.close")} onClick={() => setDriftTarget(null)} />
                    </div>
                    {driftLoading || !driftDetail ? (
                      <Skeleton height={100} />
                    ) : (
                      <DriftCompare
                        previous={driftDetail.previous}
                        current={driftDetail.current}
                        previousUnavailable={driftDetail.previous_unavailable}
                        onConfirm={handleConfirmDrift}
                        confirming={confirmDrift.isPending}
                      />
                    )}
                  </div>
                ) : !selectedPath ? (
                  <EmptyState icon="Eye" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
                ) : preview.isLoading ? (
                  <div style={{ padding: 20 }}>
                    <Skeleton height={20} style={{ marginBottom: 12 }} />
                    <Skeleton height={200} />
                  </div>
                ) : preview.isError ? (
                  <ErrorState
                    title={t("preview.loadError")}
                    body={preview.error instanceof ApiError ? preview.error.message : undefined}
                    onRetry={() => preview.refetch()}
                  />
                ) : preview.data ? (
                  <DocumentPreview
                    path={preview.data.path}
                    body={preview.data.body}
                    tokens={preview.data.tokens}
                    truncated={preview.data.truncated}
                    usedByAgents={preview.data.used_by_agents}
                  />
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
