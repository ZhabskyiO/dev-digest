/* hooks/evals.ts — React Query hooks for the L07 eval pipeline:
   cases born from findings, batch runs, run history, and the dashboard. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateEvalCaseBody,
  EvalCaseSeed,
  UpdateEvalCaseBody,
  EvalBatch,
  EvalBatchResult,
  EvalCaseFromFinding,
  EvalCaseSummary,
  EvalPipelineDashboard,
} from "@devdigest/shared";

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCaseSummary[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-runs", agentId],
    queryFn: () => api.get<EvalBatch[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** An eval-set owner: an agent's set or a skill's set. */
export interface EvalOwnerRef {
  kind: "agent" | "skill";
  id: string;
}
const ownerBase = (o: EvalOwnerRef) => `/${o.kind === "skill" ? "skills" : "agents"}/${o.id}`;
const casesKey = (o: EvalOwnerRef) =>
  o.kind === "skill" ? ["skill-eval-cases", o.id] : ["eval-cases", o.id];
const runsKey = (o: EvalOwnerRef) =>
  o.kind === "skill" ? ["skill-eval-runs", o.id] : ["eval-runs", o.id];

export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-cases", skillId],
    queryFn: () => api.get<EvalCaseSummary[]>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

export function useSkillEvalRuns(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-runs", skillId],
    queryFn: () => api.get<EvalBatch[]>(`/skills/${skillId}/eval-runs`),
    enabled: !!skillId,
  });
}

/** Run a skill's whole set as the with/without-skill benchmark. */
export function useRunSkillEvals(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalBatchResult>(`/skills/${skillId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
      qc.invalidateQueries({ queryKey: ["skill-eval-runs", skillId] });
    },
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalPipelineDashboard>("/evals/dashboard"),
  });
}

/** Lazy prefill for the case-editor modal from a decided finding — the
 *  FindingCard button fetches this and OPENS the editor instead of creating. */
export function useEvalCaseSeed() {
  return useMutation({
    mutationFn: ({ findingId }: { findingId: string }) =>
      api.get<EvalCaseSeed>(`/findings/${findingId}/eval-case-seed`),
  });
}

/** One-click "Turn into eval case" from a FindingCard. Idempotent per finding. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId }: { findingId: string }) =>
      api.post<EvalCaseFromFinding>(`/findings/${findingId}/eval-case`),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", d.case.agent_id] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

export function useCreateEvalCase(owner: EvalOwnerRef) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEvalCaseBody) =>
      api.post<EvalCaseSummary>(`${ownerBase(owner)}/eval-cases`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: casesKey(owner) }),
  });
}

export function useUpdateEvalCase(owner: EvalOwnerRef) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, patch }: { caseId: string; patch: UpdateEvalCaseBody }) =>
      api.put<EvalCaseSummary>(`/eval-cases/${caseId}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: casesKey(owner) }),
  });
}

/** Run ONE case (play button / "Run case" in the editor). Updates the case's
 *  last-run status; excluded from the comparable batch history server-side. */
export function useRunEvalCase(owner: EvalOwnerRef) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string }) =>
      api.post<EvalBatchResult>(`/eval-cases/${caseId}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: casesKey(owner) });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

export function useDeleteEvalCase(owner: EvalOwnerRef) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string }) => api.del<{ ok: true }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: casesKey(owner) });
      qc.invalidateQueries({ queryKey: runsKey(owner) });
    },
  });
}

/** Run the agent over ALL its cases (fixed inputs; scoring is code-only). */
export function useRunEvals(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalBatchResult>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-runs", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}
