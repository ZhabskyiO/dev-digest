/* hooks/brief.ts — the PR Brief (GET/POST /pulls/:id/brief[/generate]).
 *
 * `useGenerateBrief` is the **one** user-triggered action on the Overview tab
 * that spends tokens: a deliberate button press, never automatic — no retry,
 * no refetch-on-focus, no polling. The caller's job is to keep the button
 * disabled while `isPending` (mirrors `useRecalculateIntent` in reviews.ts).
 *
 * Seeds the cache from the response instead of only invalidating: the POST
 * already returns the fresh `PrBriefDetail`, so a follow-up GET would be a
 * second round-trip for data we already hold. */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PrBriefDetail } from "@devdigest/shared";
import { api } from "@/lib/api";

/** The persisted brief for a PR, if one has been generated. `null` while none
 * exists yet — that is the normal state, not an error. Nothing polls this
 * query; generation is the only thing that changes it. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<PrBriefDetail | null>(`/pulls/${prId}/brief`),
    enabled: prId != null,
  });
}

/** Generate (or regenerate) the PR brief. */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefDetail>(`/pulls/${prId}/brief/generate`),
    onSuccess: (detail) => qc.setQueryData(["pr-brief", prId], detail),
  });
}
