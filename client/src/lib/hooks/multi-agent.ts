/* hooks/multi-agent.ts — React Query hooks for the Multi-Agent Review feature.
   Start a multi-agent run, poll its live status, and preview per-agent cost/
   duration estimates before starting one. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  MultiAgentRun,
  MultiAgentRunStartResponse,
  PrAgentEstimates,
} from "@devdigest/shared";

/** The PR's current (or most recent) multi-agent run, from the server.
   `null` while none has ever been started — that is the normal state, not an
   error. Polls while the run is still in flight so the column statuses and
   the eventual conflicts land without a manual reload; self-clears once the
   run reaches a terminal status (mirrors `usePrRuns` in `reviews.ts`). */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", prId],
    queryFn: () => api.get<MultiAgentRun | null>(`/pulls/${prId}/multi-agent`),
    enabled: prId != null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 4000 : false),
  });
}

/** Per-agent cost/duration estimates for a PR, used to preview a multi-agent
   run before starting one (quick picker + Configure page). */
export function useAgentEstimates(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-estimates", prId],
    queryFn: () => api.get<PrAgentEstimates>(`/pulls/${prId}/agent-estimates`),
    enabled: prId != null,
  });
}

export interface StartMultiAgentRunInput {
  prId: string;
  agent_ids: string[];
}

/** Start a multi-agent run against the checked agent ids.
 *
 * The single mutation both the quick picker and the Configure page call —
 * whichever surface triggers it, the same request shape reaches the server
 * (AC-15). Invalidates the live run, the in-flight-runs list, and the run
 * history so every surface watching this PR picks up the new run
 * immediately. */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agent_ids }: StartMultiAgentRunInput) =>
      api.post<MultiAgentRunStartResponse>(`/pulls/${prId}/multi-agent-run`, { agent_ids }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent-run", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}
