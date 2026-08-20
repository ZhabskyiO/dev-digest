/* hooks/onboarding.ts — React Query hooks for the onboarding tour feature
   (docs/plans/onboarding-tour.md): reading a repo's stored tour and kicking
   off a (re)generation job that runs in the background (AC-26, AC-27). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTourResponse, OnboardingGenerateResponse } from "@devdigest/shared";

/** GET /repos/:id/onboarding → the stored tour plus its state (AC-48: reading
 *  it issues no model call — it only reads what's already stored). Polls only
 *  while a generation is actually in flight (`state === 'generating'`) so the
 *  page follows a background job to completion, then stops — an unconditional
 *  interval would turn this read into a permanent request loop from every
 *  open tab. */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: (query) => (query.state.data?.state === "generating" ? 2000 : false),
  });
}

/** POST /repos/:id/onboarding/generate → accepts the request immediately and
 *  runs generation in the background (AC-26); the server refuses to start a
 *  second concurrent job for the same repo (AC-27). Body-less POST —
 *  `apiFetch` only sets a JSON content-type when a body is present, so this
 *  is fine as-is. */
export function useGenerateOnboardingTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingGenerateResponse>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data) => {
      qc.setQueryData<OnboardingTourResponse>(["onboarding", repoId], (prev) => ({
        tour: prev?.tour ?? null,
        state: data.state,
        stale: prev?.stale ?? false,
        failure_reason: null,
        job_id: data.job.id,
      }));
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
