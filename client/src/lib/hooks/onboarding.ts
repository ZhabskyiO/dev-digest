/* hooks/onboarding.ts — React Query hooks for the onboarding tour feature
   (docs/plans/onboarding-tour.md): reading a repo's stored tour and kicking
   off a (re)generation job that runs in the background (AC-26, AC-27). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTourResponse, OnboardingGenerateResponse } from "@devdigest/shared";

/** How often to re-poll `GET /repos/:id/onboarding` while a generation job is
 *  in flight (`state === 'generating'`). */
const GENERATING_POLL_MS = 2000;

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
    refetchInterval: (query) => (query.state.data?.state === "generating" ? GENERATING_POLL_MS : false),
  });
}

/** POST /repos/:id/onboarding/generate → accepts the request immediately and
 *  runs generation in the background (AC-26); the server refuses to start a
 *  second concurrent job for the same repo (AC-27). Body-less POST —
 *  `apiFetch` only sets a JSON content-type when a body is present, so this
 *  is fine as-is.
 *
 *  No optimistic `setQueryData` here: an `invalidateQueries` fired
 *  immediately afterwards on the same key always wins that race (React
 *  Query refetches an active query as soon as it's invalidated), so a
 *  written-then-instantly-discarded optimistic value was dead code. Relying
 *  on the refetch alone means the UI reflects the server's own truth (it
 *  will report `state: 'generating'` for the job this call just started),
 *  which is what then arms `useOnboardingTour`'s `refetchInterval`. */
export function useGenerateOnboardingTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingGenerateResponse>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
