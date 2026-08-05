/* hooks/skills.ts — React Query hooks for the Skills Studio (L02). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  SkillType,
  SkillSource,
  CommunitySkill,
  AgentSkillLink,
  SkillImportPreview,
  SkillImportRequest,
  SkillUsage,
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
