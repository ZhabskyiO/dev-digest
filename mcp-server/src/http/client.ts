/**
 * HTTP client — the ONLY place that calls fetch against the DevDigest API.
 *
 * All response types are imported from @devdigest/shared — no shapes are
 * redefined here. Endpoints return bare shapes (no { data: ... } envelope).
 *
 * Throws ApiError on non-2xx responses.
 */

import type {
  Agent,
  Repo,
  PrMeta,
  ReviewRunResponse,
  RunSummary,
  ReviewRecord,
  RunTrace,
  ConventionCandidate,
  BlastRadiusResult,
  LocalReviewRequest,
  LocalReviewResult,
} from '@devdigest/shared';
import { config } from '../config.js';

/** Typed HTTP error with status code and request URL for forward-leading messages. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${config.apiUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...init,
    });
  } catch (cause) {
    // Network-level failure (DNS, ECONNREFUSED, etc.)
    throw new ApiError(0, url, `Network error reaching ${url}: ${String(cause)}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore body-read failure
    }
    throw new ApiError(res.status, url, `HTTP ${res.status} from ${url}: ${detail}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API surface — mirrors the DevDigest API endpoints used by MCP tools
// ---------------------------------------------------------------------------

/** GET /agents → Agent[] */
export async function listAgents(): Promise<Agent[]> {
  return request<Agent[]>('/agents');
}

/** GET /repos → Repo[] */
export async function listRepos(): Promise<Repo[]> {
  return request<Repo[]>('/repos');
}

/** GET /repos/:repoId/pulls → PrMeta[] */
export async function listPulls(repoId: string): Promise<PrMeta[]> {
  return request<PrMeta[]>(`/repos/${encodeURIComponent(repoId)}/pulls`);
}

/**
 * POST /pulls/:pullId/review { agentId } → ReviewRunResponse
 * Body: { agentId: string }
 * Returns: { pr_id, runs: [{ run_id, agent_id, agent_name }], reviews: [] }
 * Background fire-and-forget. Rate-limited 10/min.
 */
export async function triggerReview(
  pullId: string,
  agentId: string,
): Promise<ReviewRunResponse> {
  return request<ReviewRunResponse>(`/pulls/${encodeURIComponent(pullId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

/** GET /pulls/:pullId/runs → RunSummary[] */
export async function listRuns(pullId: string): Promise<RunSummary[]> {
  return request<RunSummary[]>(`/pulls/${encodeURIComponent(pullId)}/runs`);
}

/** GET /pulls/:pullId/reviews → ReviewRecord[] */
export async function listReviews(pullId: string): Promise<ReviewRecord[]> {
  return request<ReviewRecord[]>(`/pulls/${encodeURIComponent(pullId)}/reviews`);
}

/** GET /runs/:runId/trace → RunTrace */
export async function getTrace(runId: string): Promise<RunTrace> {
  return request<RunTrace>(`/runs/${encodeURIComponent(runId)}/trace`);
}

/** GET /repos/:repoId/conventions → ConventionCandidate[] */
export async function listConventions(repoId: string): Promise<ConventionCandidate[]> {
  return request<ConventionCandidate[]>(
    `/repos/${encodeURIComponent(repoId)}/conventions`,
  );
}

/** GET /pulls/:pullId/blast → BlastRadiusResult */
export async function getBlastRadius(pullId: string): Promise<BlastRadiusResult> {
  return request<BlastRadiusResult>(`/pulls/${encodeURIComponent(pullId)}/blast`);
}

/**
 * POST /reviews/local → LocalReviewResult
 *
 * Reviews a raw diff that has no PR behind it (the `devdigest review` CLI).
 * Synchronous: the server runs the review inline and answers with the grounded
 * findings, so unlike triggerReview there is nothing to poll. Rate-limited
 * 10/min, same as a PR review.
 *
 * `timeoutMs` aborts the request — an LLM review takes tens of seconds and Node
 * would otherwise wait indefinitely for a server that never answers.
 */
export async function reviewLocalDiff(
  body: LocalReviewRequest,
  opts?: { timeoutMs?: number },
): Promise<LocalReviewResult> {
  return request<LocalReviewResult>('/reviews/local', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(opts?.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  });
}

/** Bundled client object for dependency injection into tools and core modules. */
export type DevDigestClient = {
  listAgents: typeof listAgents;
  listRepos: typeof listRepos;
  listPulls: typeof listPulls;
  triggerReview: typeof triggerReview;
  listRuns: typeof listRuns;
  listReviews: typeof listReviews;
  getTrace: typeof getTrace;
  listConventions: typeof listConventions;
  getBlastRadius: typeof getBlastRadius;
  reviewLocalDiff: typeof reviewLocalDiff;
};

export function createClient(): DevDigestClient {
  return {
    listAgents,
    listRepos,
    listPulls,
    triggerReview,
    listRuns,
    listReviews,
    getTrace,
    listConventions,
    getBlastRadius,
    reviewLocalDiff,
  };
}
