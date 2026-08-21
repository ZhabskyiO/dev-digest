import { z } from 'zod';

import { ProjectContextRef } from './project-context.js';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'routes_and_apis',
  'local_setup',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionKind = z.infer<typeof OnboardingSectionKind>;

export const OnboardingComplexity = z.enum(['low', 'medium', 'high']);
export type OnboardingComplexity = z.infer<typeof OnboardingComplexity>;

export const OnboardingSurface = z.enum(['frontend', 'api']);
export type OnboardingSurface = z.infer<typeof OnboardingSurface>;

// ---- Onboarding item shapes (shared between the stored section's `items`
// and the model-facing draft's per-kind list field) ----
export const OnboardingCriticalPath = z.object({
  path: z.string(),
  why: z.string(),
});
export type OnboardingCriticalPath = z.infer<typeof OnboardingCriticalPath>;

export const OnboardingRouteEntry = z.object({
  surface: OnboardingSurface,
  group: z.string(),
  method: z.string().nullable(),
  route: z.string(),
  source_path: z.string(),
  note: z.string().nullable(),
});
export type OnboardingRouteEntry = z.infer<typeof OnboardingRouteEntry>;

export const OnboardingCommand = z.object({
  command: z.string(),
});
export type OnboardingCommand = z.infer<typeof OnboardingCommand>;

export const OnboardingReadingStep = z.object({
  path: z.string(),
  rationale: z.string(),
});
export type OnboardingReadingStep = z.infer<typeof OnboardingReadingStep>;

export const OnboardingFirstTask = z.object({
  title: z.string(),
  target: z.string(),
  complexity: OnboardingComplexity,
});
export type OnboardingFirstTask = z.infer<typeof OnboardingFirstTask>;

// ---- Onboarding section (stored/served shape) ----
// Discriminated by `kind`. Only `architecture` and `routes_and_apis` may carry
// a mermaid `diagram` (AC-13) — the other four arms fix `diagram` to
// `z.null().optional()`, so supplying any non-null diagram on them fails to
// parse (structural enforcement, not a refinement).
const OnboardingArchitectureSection = z.object({
  kind: z.literal('architecture'),
  title: z.string(),
  body: z.string(), // markdown, required and non-empty in practice (AC-13)
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink).nullish(),
});

const OnboardingCriticalPathsSection = z.object({
  kind: z.literal('critical_paths'),
  title: z.string(),
  items: z.array(OnboardingCriticalPath),
  diagram: z.null().optional(),
  links: z.array(OnboardingLink).nullish(),
  empty_reason: z.string().nullish(),
});

const OnboardingRoutesAndApisSection = z.object({
  kind: z.literal('routes_and_apis'),
  title: z.string(),
  diagram: z.string().nullish(), // mermaid
  items: z.array(OnboardingRouteEntry),
  // Set when the index carried no extracted endpoint facts to check entries
  // against; entries survive on declaring-file grounding alone (AC-52).
  facts_unavailable: z.boolean().nullish(),
  items_capped: z.boolean().nullish(),
  links: z.array(OnboardingLink).nullish(),
  empty_reason: z.string().nullish(),
});

const OnboardingLocalSetupSection = z.object({
  kind: z.literal('local_setup'),
  title: z.string(),
  items: z.array(OnboardingCommand),
  diagram: z.null().optional(),
  links: z.array(OnboardingLink).nullish(),
  empty_reason: z.string().nullish(),
});

const OnboardingReadingPathSection = z.object({
  kind: z.literal('reading_path'),
  title: z.string(),
  items: z.array(OnboardingReadingStep),
  diagram: z.null().optional(),
  links: z.array(OnboardingLink).nullish(),
  empty_reason: z.string().nullish(),
});

const OnboardingFirstTasksSection = z.object({
  kind: z.literal('first_tasks'),
  title: z.string(),
  items: z.array(OnboardingFirstTask),
  diagram: z.null().optional(),
  links: z.array(OnboardingLink).nullish(),
  empty_reason: z.string().nullish(),
});

export const OnboardingSection = z.discriminatedUnion('kind', [
  OnboardingArchitectureSection,
  OnboardingCriticalPathsSection,
  OnboardingRoutesAndApisSection,
  OnboardingLocalSetupSection,
  OnboardingReadingPathSection,
  OnboardingFirstTasksSection,
]);
export type OnboardingSection = z.infer<typeof OnboardingSection>;

// The stored payload (`onboarding` table's `json` column). Always exactly six
// sections, one per `OnboardingSectionKind`, in AC-1's fixed order.
export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
  generated_at: z.string(),
  indexed_revision: z.string(),
  indexed_file_count: z.number().int(),
  provider: z.string(),
  model: z.string(),
  degraded_reason: z.string().nullish(),
});
export type Onboarding = z.infer<typeof Onboarding>;

// GET response for the tour route.
export const OnboardingTourResponse = z.object({
  tour: Onboarding.nullable(),
  state: z.enum(['ready', 'empty', 'generating', 'failed', 'not_indexed']),
  stale: z.boolean(),
  failure_reason: z.string().nullish(),
  job_id: z.string().nullish(),
});
export type OnboardingTourResponse = z.infer<typeof OnboardingTourResponse>;

// POST (regenerate) response — identifies the in-flight generation job. The
// same job id is returned to a request that joins an already-running job.
export const OnboardingGenerateResponse = z.object({
  state: z.literal('generating'),
  job: z.object({ id: z.string() }),
});
export type OnboardingGenerateResponse = z.infer<typeof OnboardingGenerateResponse>;

// ---- Onboarding draft (model-facing shape) ----
// Flat: every field is plain and REQUIRED, with no `.default()` anywhere.
// This is passed as `schema:` to `completeStructured` — a `.default(...)`
// here would emit a `"default"` keyword via `toJsonSchema` that OpenAI's
// strict structured-output mode rejects, while the field would still land in
// `required` regardless (see server/insights/gotchas.md, 2026-08-08). Use
// `.nullable()` (never `.nullish()`/`.optional()`) for "no value" markers, so
// the key stays required but its value may be `null`.
export const OnboardingDraftSection = z.object({
  kind: OnboardingSectionKind,
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullable(),
  links: z.array(OnboardingLink),
  critical_paths: z.array(OnboardingCriticalPath),
  routes: z.array(OnboardingRouteEntry),
  commands: z.array(OnboardingCommand),
  reading_path: z.array(OnboardingReadingStep),
  first_tasks: z.array(OnboardingFirstTask),
});
export type OnboardingDraftSection = z.infer<typeof OnboardingDraftSection>;

export const OnboardingDraft = z.object({
  sections: z.array(OnboardingDraftSection),
});
export type OnboardingDraft = z.infer<typeof OnboardingDraft>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
  // Ordered project-context document attachments at snapshot time (AC-19).
  // `.default([])` is safe here — this contract is never passed as `schema:`
  // to llm.completeStructured, so the "default fields still land in
  // `required` and OpenAI's strict structured-output rejects `default`" trap
  // (server/insights/gotchas.md, 2026-08-08) does not apply. It IS required for every
  // pre-existing `agent_versions` row: `toAgentVersionDto` (helpers.ts:39)
  // `.parse()`s stored `config_json` that predates this field, and a required
  // key would throw on every one of them.
  context: z.array(ProjectContextRef).default([]),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
