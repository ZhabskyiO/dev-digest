import { z } from 'zod';

import { SkillSource, SkillType } from './knowledge.js';

/**
 * Skills Studio: versioned skill bodies, import preview/request, and usage
 * stats. Extends contracts/knowledge.ts's Skill/CommunitySkill without
 * redefining them.
 */

/** One row from `skill_versions` — an immutable body snapshot at a version. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * Result of POST /skills/import/preview. Persists nothing; `skipped` lists
 * archive entries that were read but ignored (scripts, binaries, extra
 * markdown files).
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source: SkillSource,
  skipped: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const SkillImportRequest = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('file'),
    filename: z.string(),
    content_b64: z.string(),
  }),
  z.object({
    source: z.literal('url'),
    url: z.string().url(),
  }),
  // `id` is the community catalog entry's `repo` field, its stable key — the
  // CommunitySkill DTO has no separate id field.
  z.object({
    source: z.literal('community'),
    id: z.string(),
  }),
]);
export type SkillImportRequest = z.infer<typeof SkillImportRequest>;

/** One row of GET /skills/usage?agent_id=&days=. */
export const SkillUsage = z.object({
  skill_id: z.string(),
  name: z.string(),
  type: SkillType,
  // Distinct runs in the window that included this skill.
  runs: z.number().int(),
  // runs divided by (distinct runs in the window that had at least one enabled
  // skill attached), times 100, rounded — NOT a share of all the agent's runs.
  pct: z.number(),
});
export type SkillUsage = z.infer<typeof SkillUsage>;
