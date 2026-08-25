import { z } from 'zod';
import { Severity, FindingCategory, Finding } from './findings.js';
import { EvalRun, Provider } from './knowledge.js';

/**
 * L07 — Eval Pipeline (product-plane regression harness) API contracts.
 *
 * EXTENDS the barrel like `eval-ci.ts` does; existing contract files are
 * untouched. The base analytic shapes (`EvalRun`, `EvalCase`, `EvalPerTrace`)
 * live in `knowledge.ts`; `eval-ci.ts` holds the L06 dashboard aggregate.
 * Here we add the shapes for the eval pipeline built on real findings:
 *
 *  - `EvalExpectation` — the `expected_output` payload of an `eval_cases` row
 *    born from an accepted (`must_find`) or dismissed (`must_not_flag`)
 *    finding.
 *  - `EvalCaseSummary` — a case as listed in the AgentEditor Evals tab.
 *  - `EvalBatch` — ONE press of "Run evals": the agent executed over every
 *    case of its set. Persisted as one `eval_runs` row PER CASE sharing a
 *    `batch_id` (the given schema has no batch table); the batch is the
 *    read-side aggregation of those rows.
 */

// ---- Expectation (what a case asserts) ------------------------------------

export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

/** `expected_output` of an eval case. Scoring matches on file + line overlap. */
export const EvalExpectation = z.object({
  type: EvalExpectationType,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
  /** The finding this case was created from (traceability; not scored). */
  source_finding_id: z.string().nullish(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

// ---- Cases ----------------------------------------------------------------

/** Latest execution of one case (status chip in the cases list). */
export const EvalCaseLastRun = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  pass: z.boolean().nullable(),
  findings_count: z.number().int().nullable(),
  /** Findings that hit the expected file+range in that run. */
  matched: z.number().int().nullish(),
  /** Skill-owned cases: did the case ALSO pass without the skill injected? */
  baseline_pass: z.boolean().nullish(),
});
export type EvalCaseLastRun = z.infer<typeof EvalCaseLastRun>;

export const EvalCaseSummary = z.object({
  id: z.string(),
  /** Owner id (an agent OR a skill — see owner_kind). Field name is historic. */
  agent_id: z.string(),
  owner_kind: z.enum(['agent', 'skill']).nullish(),
  name: z.string(),
  input_diff: z.string(),
  /** null when `expected_output` failed to parse (malformed hand-edited case). */
  expectation: EvalExpectation.nullable(),
  notes: z.string().nullable(),
  meta: z.unknown(),
  last_run: EvalCaseLastRun.nullable(),
});
export type EvalCaseSummary = z.infer<typeof EvalCaseSummary>;

/** Response of `POST /findings/:id/eval-case` — idempotent per finding. */
export const EvalCaseFromFinding = z.object({
  case: EvalCaseSummary,
  /** false when the finding already had a case (the existing one is returned). */
  created: z.boolean(),
});
export type EvalCaseFromFinding = z.infer<typeof EvalCaseFromFinding>;


/** Simulated PR metadata stored in `input_meta.pr_meta` and injected into the
 *  run's task line — lets a case carry the PR framing the diff was judged in. */
export const EvalCasePrMeta = z.object({
  title: z.string().default(''),
  body: z.string().default(''),
});
export type EvalCasePrMeta = z.infer<typeof EvalCasePrMeta>;
/** Body of `POST /agents/:id/eval-cases` (manual case authoring). */
export const CreateEvalCaseBody = z.object({
  name: z.string().min(1),
  input_diff: z.string().min(1),
  expected_output: EvalExpectation,
  notes: z.string().nullish(),
  pr_meta: EvalCasePrMeta.nullish(),
  /** Provenance when the case was seeded from a finding via the editor. */
  source_finding_id: z.string().nullish(),
});
export type CreateEvalCaseBody = z.infer<typeof CreateEvalCaseBody>;

/** Body of `PUT /eval-cases/:id` (case editor). All fields optional; only
 *  provided ones change. `expected_output` revalidates as a full expectation. */
export const UpdateEvalCaseBody = z.object({
  name: z.string().min(1).optional(),
  input_diff: z.string().min(1).optional(),
  expected_output: EvalExpectation.optional(),
  notes: z.string().nullish(),
  pr_meta: EvalCasePrMeta.nullish(),
});
export type UpdateEvalCaseBody = z.infer<typeof UpdateEvalCaseBody>;


/** Response of `GET /findings/:id/eval-case-seed` — everything the case-editor
 *  modal needs to open PREFILLED from a decided finding, without creating
 *  anything yet. Same derivation as the one-click create, minus the insert. */
export const EvalCaseSeed = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** Human-readable prefill; slugified server-side on save. */
  name: z.string(),
  input_diff: z.string(),
  expectation: EvalExpectation,
  pr_meta: EvalCasePrMeta,
  decision: z.enum(['accepted', 'dismissed']),
  /** Set when this finding already has a case (duplicate hint). */
  existing_case_id: z.string().nullable(),
});
export type EvalCaseSeed = z.infer<typeof EvalCaseSeed>;

// ---- Batches (run history) ------------------------------------------------

export const EvalBatch = z.object({
  batch_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullish(),
  /** Agent config version at run time — the "old prompt vs new" axis. */
  agent_version: z.number().int().nullable(),
  model: z.string().nullable(),
  provider: Provider.nullish(),
  ran_at: z.string(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  passed: z.number().int(),
  total: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** Skill-owned batches: the skill under test (agent_id is the carrier). */
  skill_id: z.string().nullish(),
  /** Skill-owned batches: the same cases run WITHOUT the skill (measured lift). */
  baseline: z
    .object({
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
      passed: z.number().int(),
      total: z.number().int(),
    })
    .nullish(),
});
export type EvalBatch = z.infer<typeof EvalBatch>;

/** Response of `POST /agents/:id/eval-runs`. */
export const EvalBatchResult = z.object({
  batch: EvalBatch,
  /** Full metric detail incl. per-trace expected/actual (knowledge.EvalRun). */
  result: EvalRun,
});
export type EvalBatchResult = z.infer<typeof EvalBatchResult>;

// ---- Dashboard ------------------------------------------------------------

export const EvalDashboardAgent = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  cases_total: z.number().int(),
  latest: EvalBatch.nullable(),
  /** Deltas vs the previous batch; null when fewer than two batches exist. */
  delta: z
    .object({
      recall: z.number(),
      precision: z.number(),
      citation_accuracy: z.number(),
    })
    .nullable(),
  /** Chronological recall per batch (sparkline). */
  trend: z.array(z.number()),
});
export type EvalDashboardAgent = z.infer<typeof EvalDashboardAgent>;

export const EvalPipelineDashboard = z.object({
  agents: z.array(EvalDashboardAgent),
  /** Latest batches across all agents, newest first. */
  recent: z.array(EvalBatch),
});
export type EvalPipelineDashboard = z.infer<typeof EvalPipelineDashboard>;

// ---- Scoring I/O (pure, code-only — no model in the loop) -----------------

/** One executed case, pre-scoring: what the agent returned on the fixed input. */
export const EvalCaseOutcome = z.object({
  case_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation.nullable(),
  /** Findings that SURVIVED the citation-grounding gate. */
  kept: z.array(Finding),
  /** Count of findings the grounding gate dropped (feeds citation_accuracy). */
  dropped_count: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;
