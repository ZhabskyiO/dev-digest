"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, IconBtn, Skeleton } from "@devdigest/ui";
import type { Agent, EffectiveProjectContextDoc, ProjectContextRef } from "@devdigest/shared";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import {
  useProjectContextDocuments,
  useAgentContext,
  useSetAgentContext,
  useDocumentDrift,
  useDocumentPreview,
  useConfirmDrift,
  type ProjectContextOwnerKind,
} from "../../../../../../../lib/hooks/project-context";
import {
  AttachmentList,
  DocumentFilter,
  DocumentPreview,
  TokenBudgetBar,
  DriftBadge,
  DriftCompare,
  type AttachmentListItem,
} from "../../../../../../../components/project-context";
import { filterByPath, reorderRefs } from "./helpers";
import { s } from "./styles";

/** Which drift detail is open, and everything `useDocumentDrift`/
 *  `useConfirmDrift` need to fetch/confirm it — resolved from whichever
 *  effective-context doc's marker was clicked, so the owner is always the
 *  entity that actually holds the attachment (the agent itself, or the
 *  skill it was inherited from — AC-37, AC-38). */
interface DriftTarget {
  repoId: string;
  ownerKind: ProjectContextOwnerKind;
  ownerId: string;
  path: string;
}

/**
 * Context tab — attaches the repo's discovered specs/docs/insights to this
 * agent (AC-12, AC-14, AC-15) and shows the agent's *effective* set: its own
 * attachments plus everything inherited from linked, globally-enabled skills
 * (AC-16), against the configured token budget (AC-17, AC-40, AC-41).
 *
 * Every toggle/reorder persists immediately through `useSetAgentContext` —
 * there is no separate Save step, matching SkillsTab's attach/detach model.
 *
 * Agents are workspace-scoped but documents are repo-scoped (AC-25). The repo
 * is the one selected in the shell's top-left repo dropdown (`useActiveRepo`)
 * — this tab deliberately has NO repository picker of its own: a second,
 * tab-local notion of "current repo" contradicted the shell's and made it
 * possible to attach a document from a repo the user was not looking at.
 * Only the active repo's documents can be attached. Attachments already made
 * against another repo stay saved and still appear in "Attached documents"
 * (they are simply not re-attachable from here until that repo is active).
 *
 * Reordering is drag-and-drop; `AttachmentList` keeps it keyboard-operable.
 * Preview opens in a right-side `Drawer`, the same affordance the skill tab
 * uses, rather than pushing the list down with an inline panel.
 *
 * Inherited-from-skill rows render read-only: removing one here would mean
 * detaching the source skill, which this tab does not do.
 */
export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: docsResp, isLoading: docsLoading } = useProjectContextDocuments(repoId);
  const { data: effective, isLoading: effectiveLoading } = useAgentContext(agent.id);
  const setContext = useSetAgentContext(agent.id);
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const { data: preview } = useDocumentPreview(repoId, previewPath);

  const directDocs = (effective?.documents ?? []).filter((d) => d.source === "agent");
  const inheritedDocs = (effective?.documents ?? []).filter((d) => d.source === "skill");
  // The full ordered ref list PUT persists on every toggle/move — the whole
  // set, not a delta (AC-14).
  const directRefs: ProjectContextRef[] = directDocs.map((d) => ({ repo_id: d.repo_id, path: d.path }));

  const isDirectlyAttached = (path: string) =>
    repoId != null && directRefs.some((r) => r.repo_id === repoId && r.path === path);

  const attach = (path: string) => {
    if (!repoId) return;
    // AC-15: attaching an already-attached path is a no-op.
    if (isDirectlyAttached(path)) return;
    setContext.mutate([...directRefs, { repo_id: repoId, path }]);
  };
  const detach = (path: string) => {
    setContext.mutate(directRefs.filter((r) => r.path !== path));
  };
  /** Persists the whole ordered set in the order the drag produced
   *  (`reorderRefs` keeps rows the list wasn't showing — see its doc). */
  const reorder = (paths: string[]) => setContext.mutate(reorderRefs(directRefs, paths));

  // Drift detail (AC-37, AC-38): opened from either the "Attached documents"
  // list (owner = this agent) or an inherited row (owner = the source
  // skill) — `openDrift` resolves the right owner from the doc clicked.
  const [driftTarget, setDriftTarget] = React.useState<DriftTarget | null>(null);
  const { data: driftDetail, isLoading: driftLoading } = useDocumentDrift(
    driftTarget?.repoId,
    driftTarget?.ownerKind,
    driftTarget?.ownerId,
    driftTarget?.path,
  );
  const confirmDrift = useConfirmDrift();

  const openDrift = (d: EffectiveProjectContextDoc) => {
    const ownerId = d.source === "agent" ? agent.id : d.skill_id;
    if (!ownerId) return;
    setDriftTarget({ repoId: d.repo_id, ownerKind: d.source, ownerId, path: d.path });
  };
  const handleConfirmDrift = () => {
    if (!driftTarget) return;
    confirmDrift.mutate(driftTarget, { onSuccess: () => setDriftTarget(null) });
  };

  if (!reposLoaded || effectiveLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={200} />
        <Skeleton height={80} />
        <Skeleton height={160} />
      </div>
    );
  }

  if (!activeRepo) {
    return (
      <div style={s.wrap}>
        <h2 style={s.h2}>{t("agentTab.title")}</h2>
        <p style={s.empty}>{t("agentTab.noRepos")}</p>
      </div>
    );
  }

  const attachedItems: AttachmentListItem[] = filterByPath(directDocs, filter).map((d) => ({
    path: d.path,
    type: d.type,
    tokens: d.tokens,
    checked: true,
    drift: d.drift,
  }));

  const browseDocsAll = docsResp?.documents ?? [];
  const browseDocs = browseDocsAll.filter((d) => !isDirectlyAttached(d.path));
  const browseItems: AttachmentListItem[] = filterByPath(browseDocs, filter).map((d) => ({
    path: d.path,
    type: d.type,
    tokens: d.tokens,
    checked: false,
    drift: d.drift,
    usedByAgents: d.used_by_agents,
  }));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("agentTab.title")}</h2>
      </div>
      <p style={s.footerNote}>{t("agentTab.footerNote")}</p>

      <TokenBudgetBar
        totalTokens={effective?.total_tokens ?? 0}
        budgetTokens={effective?.budget_tokens ?? docsResp?.budget_tokens ?? 0}
        overBudget={effective?.over_budget ?? false}
        droppedPaths={effective?.dropped_paths ?? []}
      />

      <DocumentFilter value={filter} onChange={setFilter} />

      <div style={s.section}>
        <div style={s.sectionLabel}>{t("agentTab.attachedTitle")}</div>
        <AttachmentList
          items={attachedItems}
          onToggle={detach}
          onReorder={reorder}
          onPreview={setPreviewPath}
        />
        {directDocs.some((d) => d.drift) && (
          <div style={s.driftList}>
            {directDocs
              .filter((d) => d.drift)
              .map((d) => (
                <div key={d.path} style={s.driftRow}>
                  <span className="mono" style={s.driftPath}>
                    {d.path}
                  </span>
                  <DriftBadge onClick={() => openDrift(d)} />
                </div>
              ))}
          </div>
        )}
      </div>

      {driftTarget && (
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
      )}

      {inheritedDocs.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionLabel}>{t("agentTab.inheritedTitle")}</div>
          <div style={s.list} role="list">
            {inheritedDocs.map((d) => (
              <div key={d.path} role="listitem" style={s.inheritedRow}>
                <span className="mono" style={s.inheritedPath}>
                  {d.path}
                </span>
                {d.drift && <DriftBadge onClick={() => openDrift(d)} />}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("agentTab.inheritedFrom", { skill: d.skill_id ?? "" })}
                </span>
                <span className="tnum" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("tokens.approx", { count: d.tokens })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={s.section}>
        <div style={s.sectionLabel}>
          {t("agentTab.browseTitle", { repo: activeRepo.full_name })}
        </div>
        {docsLoading ? (
          <Skeleton height={120} />
        ) : (
          <AttachmentList items={browseItems} onToggle={attach} onPreview={setPreviewPath} />
        )}
      </div>

      {previewPath && (
        <Drawer
          width={640}
          title={t("preview.drawerTitle")}
          subtitle={previewPath}
          onClose={() => setPreviewPath(null)}
        >
          {preview ? (
            <DocumentPreview
              path={preview.path}
              body={preview.body}
              tokens={preview.tokens}
              truncated={preview.truncated}
              usedByAgents={preview.used_by_agents}
            />
          ) : (
            <Skeleton height={200} />
          )}
        </Drawer>
      )}
    </div>
  );
}
