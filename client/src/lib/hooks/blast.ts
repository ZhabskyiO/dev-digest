/* Blast radius — the PR impact map (GET /pulls/:id/blast).

   Read-only and cheap: the endpoint serves the repo-intel index, no model call,
   so there is no mutation counterpart here (unlike intent, which has an
   explicit re-derive). Refreshing the map means re-indexing the repo, which is
   `useResyncRepoIntel` in hooks/repo-intel.ts. */
import { useQuery } from "@tanstack/react-query";
import type { BlastRadiusResult } from "@devdigest/shared";
import { api } from "@/lib/api";

export function useBlastRadius(
  prId: string | null | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadiusResult>(`/pulls/${prId}/blast`),
    enabled: prId != null && (opts?.enabled ?? true),
  });
}
