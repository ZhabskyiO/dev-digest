/* hooks/conventions.ts — React Query hooks for convention extraction.
     POST /repos/:id/conventions/extract → scan + verify + persist (synchronous)
     GET  /repos/:id/conventions         → candidates (?status= filter)
     PATCH /conventions/:id              → approve / reject / edit
     POST /repos/:id/conventions/skill   → fold chosen candidates into a skill */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidateDetail,
  ConventionCategory,
  ConventionExtractResult,
  ConventionStatus,
  Skill,
  SkillType,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidateDetail[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Extraction is one model call the user waits on — no polling, no 202. */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      qc.setQueryData(["conventions", repoId], data.candidates);
    },
  });
}

export interface UpdateConventionArgs {
  id: string;
  patch: {
    status?: ConventionStatus;
    rule?: string;
    category?: ConventionCategory;
  };
}

export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionArgs) =>
      api.patch<ConventionCandidateDetail>(`/conventions/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface CreateSkillFromConventionsInput {
  candidate_ids: string[];
  name: string;
  description: string;
  body: string;
  type?: SkillType;
  enabled?: boolean;
  agent_id?: string | null;
}

export interface SkillFromConventions {
  skill: Skill;
  linked_agent_id: string | null;
  accepted: number;
}

export function useCreateSkillFromConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillFromConventionsInput) =>
      api.post<SkillFromConventions>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: (data) => {
      // The candidates are now accepted, a skill exists, and — when an agent was
      // picked — that agent's skill list changed too.
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
      if (data.linked_agent_id) {
        qc.invalidateQueries({ queryKey: ["agent-skills", data.linked_agent_id] });
      }
    },
  });
}
