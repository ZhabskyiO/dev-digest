/* ContextTab — the skill's "Project context to use" section (specs/2026-08-18
   -project-context.md). Attaches repo documents to the skill and submits the
   ordered attachment list as part of the skill save — `PATCH /skills/:id
   { …, context }`, the SAME endpoint ConfigTab's body edits go through, not a
   dedicated context mutation (a separate call would append a second
   `skill_versions` row for one logical save and break AC-42).

   Skills are workspace-scoped while documents are repository-scoped (AC-25).
   The repository is whichever one is selected in the shell's top-left repo
   dropdown (`useActiveRepo`) — this tab has NO picker of its own, so only the
   active repo's documents can be attached, and the tab can never disagree
   with the repo the rest of the app is showing. A skill may still CARRY
   attachments made against other repositories; those stay saved and are
   skipped on a run against any other repository (see the inherit hint), they
   are simply not browsable here until that repo is the active one.

   Reordering is drag-and-drop (`AttachmentList` keeps it keyboard-operable);
   preview opens in a right-side `Drawer` rather than inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, ErrorState, IconBtn, Skeleton } from "@devdigest/ui";
import type { ProjectContextRef, Skill } from "@devdigest/shared";
import {
  AttachmentList,
  DocumentFilter,
  DocumentPreview,
  DriftBadge,
  DriftCompare,
  type AttachmentListItem,
} from "../../../../../../components/project-context";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import {
  useConfirmDrift,
  useDocumentDrift,
  useDocumentPreview,
  useProjectContextDocuments,
  useSkillContext,
} from "../../../../../../lib/hooks/project-context";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { refsEqual, reorderDraft } from "./helpers";
import { s } from "./styles";

/** Which drift detail is open — the skill is always the owner here, so only
 *  the repo/path the marker was clicked on needs tracking (AC-37, AC-38). */
interface DriftTarget {
  repoId: string;
  path: string;
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const toast = useToast();

  const { activeRepo, reposLoaded } = useActiveRepo();
  const { data: attachments, isLoading: attachmentsLoading } = useSkillContext(skill.id);
  const update = useUpdateSkill();

  const [filter, setFilter] = React.useState("");
  const [draft, setDraft] = React.useState<ProjectContextRef[]>([]);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  // Seed the editable draft from the persisted attachment set whenever a
  // different skill loads, or a save lands and the query refetches — the
  // same reset-on-load pattern ConfigTab uses for `body` (client/insights/
  // has no entry against it; it is this codebase's established way to give
  // an edit form a local draft seeded from server state).
  React.useEffect(() => {
    if (!attachments) return;
    setDraft(
      [...attachments]
        .sort((a, b) => a.order - b.order)
        .map((a) => ({ repo_id: a.repo_id, path: a.path })),
    );
  }, [skill.id, attachments]);

  const selectedRepoId = activeRepo?.id ?? null;

  const { data: docsResponse, isLoading: docsLoading } = useProjectContextDocuments(selectedRepoId);
  const { data: preview } = useDocumentPreview(selectedRepoId, previewPath);

  const documents = docsResponse?.documents ?? [];
  const needle = filter.trim().toLowerCase();
  const matchesFilter = (path: string) => !needle || path.toLowerCase().includes(needle);
  const docByPath = new Map(documents.map((doc) => [doc.path, doc]));

  // TWO lists, deliberately. The attached one is built from `draft` — the
  // ATTACHMENT order — because that order is the thing being edited: it
  // decides the sequence documents are injected in (AC-14). Rendering a
  // single catalog-ordered list here was a real bug: a drag updated `draft`
  // (so Save lit up) while the row snapped straight back to its catalog
  // position, because the catalog order is not affected by attachment order.
  // The browse list below is unordered by nature and therefore not sortable.
  const attachedRefs = draft.filter((r) => r.repo_id === selectedRepoId);
  const attachedPaths = new Set(attachedRefs.map((r) => r.path));

  const attachedItems: AttachmentListItem[] = attachedRefs
    .filter((ref) => matchesFilter(ref.path) && docByPath.has(ref.path))
    .map((ref) => {
      const doc = docByPath.get(ref.path)!;
      return {
        path: doc.path,
        type: doc.type,
        tokens: doc.tokens,
        checked: true,
        drift: doc.drift,
        usedByAgents: doc.used_by_agents,
      };
    });

  const browseItems: AttachmentListItem[] = documents
    .filter((doc) => !attachedPaths.has(doc.path) && matchesFilter(doc.path))
    .map((doc) => ({
      path: doc.path,
      type: doc.type,
      tokens: doc.tokens,
      checked: false,
      drift: doc.drift,
      usedByAgents: doc.used_by_agents,
    }));

  // Attachments this list cannot render: made against another repository, or
  // pointing at a document the latest scan no longer finds. They stay in the
  // draft and survive every save and reorder, so they are surfaced as a count
  // rather than left silently invisible.
  const hiddenAttachments = draft.length - attachedRefs.length +
    attachedRefs.filter((ref) => !docByPath.has(ref.path)).length;

  const originalRefs = (attachments ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((a): ProjectContextRef => ({ repo_id: a.repo_id, path: a.path }));
  const isDirty = !refsEqual(draft, originalRefs);

  // Drift detail (AC-37, AC-38) — scoped to this skill's own persisted
  // attachments, not the local `draft`, since drift is about what's actually
  // recorded server-side.
  const driftedAttachments = (attachments ?? []).filter((a) => a.drift);
  const [driftTarget, setDriftTarget] = React.useState<DriftTarget | null>(null);
  const { data: driftDetail, isLoading: driftLoading } = useDocumentDrift(
    driftTarget?.repoId,
    "skill",
    skill.id,
    driftTarget?.path,
  );
  const confirmDrift = useConfirmDrift();

  function handleConfirmDrift() {
    if (!driftTarget) return;
    confirmDrift.mutate(
      { repoId: driftTarget.repoId, ownerKind: "skill", ownerId: skill.id, path: driftTarget.path },
      { onSuccess: () => setDriftTarget(null) },
    );
  }

  function toggle(path: string) {
    if (!selectedRepoId) return;
    setDraft((prev) => {
      const exists = prev.some((r) => r.repo_id === selectedRepoId && r.path === path);
      if (exists) return prev.filter((r) => !(r.repo_id === selectedRepoId && r.path === path));
      return [...prev, { repo_id: selectedRepoId, path }];
    });
  }

  function reorder(paths: string[]) {
    if (!selectedRepoId) return;
    setDraft((prev) => reorderDraft(prev, selectedRepoId, paths));
  }

  function save() {
    // Echoes `body` back unchanged alongside the new `context` — this is
    // "PATCH /skills/:id { …, context }" from the plan: one save call that
    // never clobbers a body edit made elsewhere, and the server only appends
    // a skill_versions snapshot for whichever of the two actually changed
    // (AC-42).
    update.mutate(
      { id: skill.id, patch: { body: skill.body, context: draft } },
      { onSuccess: () => toast.success(t("skillSection.savedToast")) },
    );
  }

  if (!reposLoaded || attachmentsLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={40} />
        <Skeleton height={220} />
      </div>
    );
  }

  if (!activeRepo) {
    return (
      <div style={s.wrap}>
        <h2 style={s.h2}>{t("skillSection.title")}</h2>
        <ErrorState title={t("skillSection.noRepos")} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.h2}>{t("skillSection.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("attachments.attachedCount", { count: draft.length })}
        </Badge>
        <span style={s.spacer} />
        <div style={{ width: 220 }}>
          <DocumentFilter value={filter} onChange={setFilter} />
        </div>
      </div>
      <p style={s.hint}>{t("skillSection.inheritHint")}</p>
      <p style={s.repoHint}>{t("skillSection.repoHint", { repo: activeRepo.full_name })}</p>

      {docsLoading ? (
        <Skeleton height={220} />
      ) : (
        <>
          <div style={s.sectionLabel}>{t("skillSection.attachedTitle")}</div>
          <AttachmentList
            items={attachedItems}
            onToggle={toggle}
            onReorder={reorder}
            onPreview={setPreviewPath}
          />
          {hiddenAttachments > 0 && (
            <p style={s.repoHint}>{t("skillSection.hiddenAttachments", { count: hiddenAttachments })}</p>
          )}

          <div style={s.sectionLabel}>
            {t("skillSection.browseTitle", { repo: activeRepo.full_name })}
          </div>
          <AttachmentList items={browseItems} onToggle={toggle} onPreview={setPreviewPath} />
        </>
      )}

      {driftedAttachments.length > 0 && (
        <div style={s.driftList}>
          {driftedAttachments.map((a) => (
            <div key={a.path} style={s.driftRow}>
              <span className="mono" style={s.driftPath}>
                {a.path}
              </span>
              <DriftBadge onClick={() => setDriftTarget({ repoId: a.repo_id, path: a.path })} />
            </div>
          ))}
        </div>
      )}

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

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !isDirty}>
          {update.isPending ? t("skillSection.saving") : t("skillSection.save")}
        </Button>
      </div>
    </div>
  );
}
