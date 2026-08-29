import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same location range
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/**
 * A finding as surfaced in a multi-agent column. Carries the same fields as
 * `FindingRecord` (`contracts/review-api.ts`) plus `kind`, but with
 * `category` deliberately left as a plain `z.string()` rather than the
 * narrower `FindingCategory` enum — this keeps a value of this shape
 * assignable where a `FindingRecord` is expected (via `satisfies
 * AgentColumnFinding`, which preserves the literal type of a concrete
 * `category` value instead of widening it to `string`).
 */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  kind: z.string().nullish(),
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** Recorded failure reason when `status === 'failed'`, else null. */
  error: z.string().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended location range. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string().nullish(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a location range that at least one agent flagged and at least
 * one other agent (that also reviewed) did NOT, OR where agents assigned
 * divergent severities. `start_line`/`end_line` is the range the group of
 * findings covers. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  status: z.enum(['queued', 'running', 'complete']),
  total_duration_ms: z.number().int().nullable(),
  total_cost_usd: z.number().nullable(),
  /** A shared failure that applies at the multi-run level rather than to one column. */
  shared_error: z.string().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** Request body of `POST /pulls/:id/multi-agent-run`. */
export const MultiAgentRunRequest = z.object({
  agent_ids: z
    .array(z.string().uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate agent id'),
});
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

/** Immediate (pre-completion) response of `POST /pulls/:id/multi-agent-run`. */
export const MultiAgentRunStartResponse = z.object({
  multi_run_id: z.string(),
  pr_id: z.string(),
  runs: z.array(
    z.object({
      run_id: z.string(),
      agent_id: z.string(),
      agent_name: z.string(),
    }),
  ),
});
export type MultiAgentRunStartResponse = z.infer<typeof MultiAgentRunStartResponse>;

/** One agent's historical run estimate, used to preview a multi-agent run before starting it. */
export const AgentRunEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  est_duration_ms: z.number().int().nullable(),
  est_cost_usd: z.number().nullable(),
  runs_sampled: z.number().int(),
  last_summary: z.string().nullable(),
});
export type AgentRunEstimate = z.infer<typeof AgentRunEstimate>;

/** Response of the endpoint that estimates run cost/duration per agent for a PR. */
export const PrAgentEstimates = z.object({
  pr_id: z.string(),
  agents: z.array(AgentRunEstimate),
});
export type PrAgentEstimates = z.infer<typeof PrAgentEstimates>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
