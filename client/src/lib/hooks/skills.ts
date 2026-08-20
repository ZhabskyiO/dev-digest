/* hooks/skills.ts — React Query hooks for the Skills Studio (L02). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  Skill,
  SkillType,
  SkillSource,
  CommunitySkill,
  AgentSkillLink,
  SkillImportPreview,
  SkillImportRequest,
  SkillStats,
  SkillStatsSummary,
  SkillUsage,
  SkillVersion,
  ProjectContextRef,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  source?: SkillSource;
  enabled?: boolean;
  /** "What changed" note; the server records it only when the body changed. */
  version_label?: string;
  /** The skill's ordered project-context attachment set (specs/2026-08-18
   *  -project-context.md, AC-13, AC-42). Sent through this same PATCH — not a
   *  separate mutation — so a body-and-attachments edit is one save and one
   *  `skill_versions` snapshot. */
  context?: ProjectContextRef[];
}

export interface UpdateSkillArgs {
  id: string;
  patch: UpdateSkillInput;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillArgs) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // A `context` save (ContextTab) changes what GET /skills/:id/context
      // would return next — without this, `useSkillContext`'s cache stays
      // stale in-session until a remount (only masked in tests by each one
      // using a fresh QueryClient).
      qc.invalidateQueries({ queryKey: ["skill-context", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/** Preview an import (file/url/community). Persists nothing server-side. */
export function useImportPreview() {
  return useMutation({
    mutationFn: (input: SkillImportRequest) =>
      api.post<SkillImportPreview>("/skills/import/preview", input),
  });
}

export function useCommunitySkills(q?: string, lang?: string) {
  return useQuery({
    queryKey: ["community-skills", q, lang],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (lang) params.set("lang", lang);
      const qs = params.toString();
      return api.get<CommunitySkill[]>(`/skills/community${qs ? `?${qs}` : ""}`);
    },
  });
}

export function useAgentSkills(agentId: string) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export interface SetAgentSkillsArgs {
  agentId: string;
  skillIds: string[];
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: SetAgentSkillsArgs) =>
      api.post(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}

// ---- skill detail: versions, agents, stats -------------------------------

/** GET /skills/:id/versions → body snapshots, newest version first. */
export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", skillId],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${skillId}/versions`),
    enabled: !!skillId,
  });
}

/** GET /skills/:id/versions/:version → one snapshot (for the diff view). */
export function useSkillVersion(skillId: string | null | undefined, version: number | null) {
  return useQuery({
    queryKey: ["skill-version", skillId, version],
    queryFn: () => api.get<SkillVersion>(`/skills/${skillId}/versions/${version}`),
    enabled: !!skillId && version !== null,
  });
}

/** GET /skills/:id/agents → agents this skill is attached to. */
export function useSkillAgents(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", skillId],
    queryFn: () => api.get<Agent[]>(`/skills/${skillId}/agents`),
    enabled: !!skillId,
  });
}

/** GET /skills/:id/stats → usage/accept/findings for one skill. */
export function useSkillStats(skillId: string | null | undefined, days?: number) {
  return useQuery({
    queryKey: ["skill-stats", skillId, days ?? null],
    queryFn: () => {
      const qs = days != null ? `?days=${days}` : "";
      return api.get<SkillStats>(`/skills/${skillId}/stats${qs}`);
    },
    enabled: !!skillId,
  });
}

/** GET /skills/stats → one summary row per skill, for the list rail. One
 *  request for the whole list rather than a fetch per card. */
export function useSkillStatsSummary(days?: number) {
  return useQuery({
    queryKey: ["skill-stats-summary", days ?? null],
    queryFn: () => {
      const qs = days != null ? `?days=${days}` : "";
      return api.get<SkillStatsSummary[]>(`/skills/stats${qs}`);
    },
  });
}

export interface RestoreSkillVersionArgs {
  skillId: string;
  version: number;
}

/**
 * POST /skills/:id/versions/:version/restore → re-apply an old body. The server
 * appends a NEW version rather than rewinding, so the version list grows.
 */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version }: RestoreSkillVersionArgs) =>
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useSkillUsage(agentId: string, days?: number) {
  return useQuery({
    queryKey: ["skill-usage", agentId, days ?? 30],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("agent_id", agentId);
      if (days != null) params.set("days", String(days));
      return api.get<SkillUsage[]>(`/skills/usage?${params.toString()}`);
    },
    enabled: !!agentId,
  });
}
