/* hooks/project-context.ts — React Query hooks for the Project Context feature
   (specs/2026-08-18-project-context.md): the repo-level document list/rescan/
   preview/drift surface, and the agent/skill attachment surface. Skill
   attachments are saved through `useUpdateSkill` (PUT /skills/:id, body
   carries `context`) — NOT a hook here — because a separate mutation would
   append two `skill_versions` rows for one logical save (AC-39, AC-42). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ProjectContextListResponse,
  ProjectContextPreview,
  ProjectContextDrift,
  ProjectContextRef,
  ProjectContextAttachment,
  EffectiveProjectContext,
} from "@devdigest/shared";

/** Which kind of owner a drift/confirm call is scoped to. */
export type ProjectContextOwnerKind = "agent" | "skill";

// ---- Repo-level document surface (GET/POST /repos/:id/context/…) --------

/** GET /repos/:id/context/documents → the discovered document list for a repo. */
export function useProjectContextDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context", repoId],
    queryFn: () => api.get<ProjectContextListResponse>(`/repos/${repoId}/context/documents`),
    enabled: !!repoId,
  });
}

/** POST /repos/:id/context/rescan → fetches origin/<defaultBranch> into the
 *  clone, THEN re-walks it and returns the fresh list (AC-6). The fetch is
 *  what makes this different from `useProjectContextDocuments`, which only
 *  reads the checkout as it already sits on disk: a document pushed after the
 *  repo was imported can only appear via this call. A failed fetch is not an
 *  error here — the response still carries the (stale) document list plus
 *  `sync_error`. Body-less POST — `apiFetch` only sets a JSON content-type
 *  when a body is present, so this is fine as-is. */
export function useRescanProjectContext(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ProjectContextListResponse>(`/repos/${repoId}/context/rescan`),
    onSuccess: (data) => {
      qc.setQueryData(["project-context", repoId], data);
    },
  });
}

/** GET /repos/:id/context/documents/preview?path=… → read-only markdown body
 *  for one document (AC-10), capped and flagged when truncated. */
export function useDocumentPreview(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["project-context-preview", repoId, path],
    queryFn: () =>
      api.get<ProjectContextPreview>(
        `/repos/${repoId}/context/documents/preview?path=${encodeURIComponent(path ?? "")}`
      ),
    enabled: !!repoId && !!path,
  });
}

/** GET /repos/:id/context/drift?owner_kind=&owner_id=&path=… → the
 *  before/after comparison for a changed-since-attached document (AC-38).
 *  Scoped to one owner because the attach-time hash/revision it compares
 *  against is recorded per attachment, not per document. */
export function useDocumentDrift(
  repoId: string | null | undefined,
  ownerKind: ProjectContextOwnerKind | null | undefined,
  ownerId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["project-context-drift", repoId, ownerKind, ownerId, path],
    queryFn: () => {
      const params = new URLSearchParams({
        owner_kind: ownerKind ?? "",
        owner_id: ownerId ?? "",
        path: path ?? "",
      });
      return api.get<ProjectContextDrift>(`/repos/${repoId}/context/drift?${params.toString()}`);
    },
    enabled: !!repoId && !!ownerKind && !!ownerId && !!path,
  });
}

export interface ConfirmDriftArgs {
  repoId: string;
  ownerKind: ProjectContextOwnerKind;
  ownerId: string;
  path: string;
}

/** POST /repos/:id/context/confirm → advances the recorded hash/size/revision
 *  to current and clears the drift marker (AC-37). Never touches the clone. */
export function useConfirmDrift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, ownerKind, ownerId, path }: ConfirmDriftArgs) =>
      api.post<{ ok: boolean }>(`/repos/${repoId}/context/confirm`, {
        owner_kind: ownerKind,
        owner_id: ownerId,
        path,
      }),
    onSuccess: (_d, { repoId, ownerKind, ownerId, path }) => {
      // Clears the drift marker wherever it's listed: the repo's document
      // list, the drift detail itself, and the confirming owner's own
      // attachment view.
      qc.invalidateQueries({ queryKey: ["project-context", repoId] });
      qc.invalidateQueries({
        queryKey: ["project-context-drift", repoId, ownerKind, ownerId, path],
      });
      if (ownerKind === "agent") {
        qc.invalidateQueries({ queryKey: ["agent-context", ownerId] });
      } else {
        qc.invalidateQueries({ queryKey: ["skill-context", ownerId] });
      }
    },
  });
}

// ---- Agent attachment surface (GET/PUT /agents/:id/context) -------------

/** GET /agents/:id/context → the agent's effective context set: its own
 *  attachments followed by attachments inherited from linked, globally
 *  enabled skills, de-duplicated (AC-16, AC-17). */
export function useAgentContext(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<EffectiveProjectContext>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

/** PUT /agents/:id/context → replaces the agent's own ordered attachment set
 *  (AC-12, AC-14, AC-19). `documents` is the full ordered list, not a delta. */
export function useSetAgentContext(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documents: ProjectContextRef[]) =>
      api.put<EffectiveProjectContext>(`/agents/${agentId}/context`, { documents }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-context", agentId], data);
      // Attaching/detaching moves a document's `used_by_agents` count on
      // every repo's document list, and we don't reliably know which repo(s)
      // from this call site alone — invalidate every project-context list.
      qc.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "project-context",
      });
    },
  });
}

// ---- Skill attachment surface (read side only — see file header) --------

/** GET /skills/:id/context → the skill's own ordered attachment list
 *  (AC-13). Saving goes through `useUpdateSkill`'s `context` field, not a
 *  hook here. */
export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<ProjectContextAttachment[]>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}
