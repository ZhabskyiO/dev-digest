import { z } from 'zod';
import { ConventionCandidate, SkillType } from './knowledge.js';

/**
 * Convention extraction contracts.
 *
 * Extends contracts/knowledge.ts's `ConventionCandidate` (the persisted shape
 * predates this feature) rather than redefining it: the base carries
 * rule/evidence/confidence/accepted, this file adds the category, the cited
 * line, the review status and the skill a candidate was folded into.
 *
 * `ConventionExtraction` is the LLM structured-output schema — its schemaName
 * is what `MockLLMProvider.structuredBySchema` keys on in tests.
 */

// ---- Categories / status ----

export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error-handling',
  'testing',
  'typing',
  'imports',
  'api-design',
  'styling',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * Review state of a candidate. `accepted` on the base contract stays in lockstep
 * (`status === 'accepted'`) — it is what the plugin-export path reads — but only
 * `status` can express "rejected", which is what keeps a rejected rule from
 * being re-suggested by the next scan.
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

// ---- Persisted candidate ----

export const ConventionCandidateDetail = ConventionCandidate.extend({
  category: ConventionCategory,
  evidence_line: z.number().int().nullable(),
  status: ConventionStatus,
  skill_id: z.string().nullable(),
  created_at: z.string(),
});
export type ConventionCandidateDetail = z.infer<typeof ConventionCandidateDetail>;

// ---- LLM structured output ----

export const ExtractedConvention = z.object({
  category: ConventionCategory,
  rule: z
    .string()
    .describe(
      'One house-rule, phrased imperatively and specific enough to check against a diff.',
    ),
  evidence_path: z
    .string()
    .describe('Repo-relative path, copied exactly from a file header in the sample.'),
  evidence_line: z
    .number()
    .int()
    .describe('The 1-based line number shown in the left gutter of the sample.'),
  evidence_snippet: z
    .string()
    .describe('The code on that line, verbatim and without the gutter number.'),
  confidence: z.number().min(0).max(1),
});
export type ExtractedConvention = z.infer<typeof ExtractedConvention>;

export const ConventionExtraction = z.object({
  conventions: z.array(ExtractedConvention),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

// ---- API DTOs ----

export const ConventionExtractResult = z.object({
  candidates: z.array(ConventionCandidateDetail),
  sampled_files: z.array(z.string()),
  /** Proposed rules whose cited evidence did not exist in the sampled code. */
  dropped: z.number().int(),
  /** Proposed rules already stored for this repo, in any status. */
  duplicates: z.number().int(),
  cost_usd: z.number().nullable(),
  degraded: z.boolean().nullish(),
  reason: z.string().nullish(),
});
export type ConventionExtractResult = z.infer<typeof ConventionExtractResult>;

export const UpdateConventionRequest = z.object({
  status: ConventionStatus.optional(),
  rule: z.string().min(1).optional(),
  category: ConventionCategory.optional(),
});
export type UpdateConventionRequest = z.infer<typeof UpdateConventionRequest>;

export const CreateSkillFromConventionsRequest = z.object({
  candidate_ids: z.array(z.string().uuid()).min(1),
  name: z.string().min(1),
  description: z.string(),
  /** Composed and edited in the UI — persisted verbatim, never re-generated. */
  body: z.string().min(1),
  type: SkillType.default('convention'),
  /** Whether the skill is added to agents' prompts straight away. */
  enabled: z.boolean().default(true),
  /** When set, the new skill is appended to this agent's ordered skill list. */
  agent_id: z.string().uuid().nullish(),
});
export type CreateSkillFromConventionsRequest = z.infer<typeof CreateSkillFromConventionsRequest>;
