/* hooks/ci.ts — the single data layer for all three CI surfaces (Export-to-CI
 * wizard, the agent's CI tab, and the CI Runs page): docs/plans/export-to-ci.md.
 *
 * Query keys:
 *   ["ci-installations", agentId] — GET /agents/:id/ci-installations
 *   ["ci-runs", query]            — GET /ci-runs
 *
 * Both polling queries take `{ poll }` rather than polling unconditionally —
 * feed them `useDocumentVisible()` from the caller so auto-refresh suspends
 * while the document is hidden (R12). See `useDocumentVisible.ts` for why
 * that can't be TanStack's own `refetchIntervalInBackground`.
 *
 * All mutations invalidate `["ci-installations"]` and/or `["ci-runs"]` (the
 * bare prefix, not a specific agent/query tuple) on success, so every open
 * installations list and every open runs list — regardless of which agent or
 * filter it's scoped to — picks up the change. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiExport,
  CiExportInputBody,
  CiInstallation,
  CiInstallationStatus,
  CiPostAs,
  CiPreview,
  CiRunList,
  CiRunsQuery,
  CiTarget,
  CiTrigger,
} from "@devdigest/shared";

/** Auto-refresh cadence for `useCiInstallations`/`useCiRuns` while polling is
 *  armed (R12) — suspended entirely (no interval) while `poll` is false. */
const CI_POLL_MS = 30_000;

export interface CiPollOptions {
  /** Feed `useDocumentVisible()` in: polls every 30s while true, suspended
   *  (no `refetchInterval`) while false. Defaults to `false` — callers opt in. */
  poll?: boolean;
}

function ciRunsQueryString(query: CiRunsQuery): string {
  const params = new URLSearchParams();
  if (query.window) params.set("window", query.window);
  if (query.agent_id) params.set("agent_id", query.agent_id);
  if (query.repo) params.set("repo", query.repo);
  if (query.status) params.set("status", query.status);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** GET /agents/:id/ci-installations → per-installation status for the CI tab
 *  (AC-2, AC-3, AC-8): the installation row, its last run, and whether the
 *  installed agent version has fallen behind the agent's current one. */
export function useCiInstallations(
  agentId: string | null | undefined,
  { poll = false }: CiPollOptions = {},
) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallationStatus[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
    refetchInterval: poll ? CI_POLL_MS : false,
  });
}

/** GET /ci-runs → the CI Runs page list (AC-46): filtered/paginated by
 *  `query` (time window, agent, repo, status, paging). */
export function useCiRuns(query: CiRunsQuery, { poll = false }: CiPollOptions = {}) {
  return useQuery({
    queryKey: ["ci-runs", query],
    queryFn: () => api.get<CiRunList>(`/ci-runs${ciRunsQueryString(query)}`),
    refetchInterval: poll ? CI_POLL_MS : false,
  });
}

/** Variables shared by the three wizard mutations below — the agent being
 *  exported plus the export input body (target/action/post_as/triggers/base,
 *  optionally a this-export-only `workflow_override`). */
export type CiExportVariables = { agentId: string } & CiExportInputBody;

/** POST /agents/:id/ci-preview → Step 2 preview: the files that WOULD be
 *  generated, with no side effects (no installation row, no PR). */
export function useCiPreview() {
  return useMutation({
    mutationFn: ({ agentId, ...body }: CiExportVariables) =>
      api.post<CiPreview>(`/agents/${agentId}/ci-preview`, body),
  });
}

/** POST /agents/:id/export-ci → writes/refreshes the CI installation and
 *  returns the generated files (plus a PR url when `action: "open_pr"`). */
export function useCiExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...body }: CiExportVariables) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}

/** Response of `POST /agents/:id/ci-archive` — no dedicated contract shape
 *  exists yet (the endpoint table's ad hoc `{ filename, content_base64 }`),
 *  so this is a plain local type rather than an `@devdigest/shared` import. */
export interface CiArchiveResult {
  filename: string;
  content_base64: string;
}

/** POST /agents/:id/ci-archive → the same generated files as a downloadable
 *  archive, for the "action: files" / no-PR path. No side effects to invalidate. */
export function useCiArchive() {
  return useMutation({
    mutationFn: ({ agentId, ...body }: CiExportVariables) =>
      api.post<CiArchiveResult>(`/agents/${agentId}/ci-archive`, body),
  });
}

/** Body for `POST /agents/:id/ci-installations` — a subset of the export
 *  input: no `action`/`workflow_override`, since confirming an installation
 *  never opens a PR or applies a this-export-only workflow edit. */
export interface ConfirmCiInstallationInput {
  agentId: string;
  repo: string;
  target: CiTarget;
  base: string;
  post_as: CiPostAs;
  triggers: CiTrigger[];
}

/** POST /agents/:id/ci-installations → confirm/persist the installation the
 *  wizard just previewed. */
export function useConfirmCiInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...body }: ConfirmCiInstallationInput) =>
      api.post<CiInstallation>(`/agents/${agentId}/ci-installations`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}

/** POST /ci-runs/refresh → re-ingest CI result artifacts, optionally scoped
 *  to one agent (`agent_id` omitted → refresh across all agents). */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { agent_id?: string }) => api.post<CiRunList>("/ci-runs/refresh", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
