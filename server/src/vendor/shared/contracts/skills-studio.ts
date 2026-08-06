import { z } from 'zod';

import { SkillSource, SkillType } from './knowledge.js';

/**
 * Skills Studio: versioned skill bodies, import preview/request, and usage
 * stats. Extends contracts/knowledge.ts's Skill/CommunitySkill without
 * redefining them.
 */

/** One row from `skill_versions` — an immutable body snapshot at a version.
 *  `label` is the author's optional "what changed" note, absent on snapshots
 *  written before labels existed. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  label: z.string().nullable(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// ---- Per-skill stats ----

export const SkillCategoryCount = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type SkillCategoryCount = z.infer<typeof SkillCategoryCount>;

/**
 * Stats for one skill over a trailing window.
 *
 * Every ratio is nullable so a zero denominator renders as "—" rather than a
 * misleading 0%. Two things to hold in mind when displaying these:
 *
 *  - `pull_pct` is the share of *skill-using* runs that attached this skill, not
 *    a share of all runs — runs with no skills attached have no `run_skills`
 *    rows and would otherwise drag every skill's number down.
 *  - `accept_rate` and `findings` are attributed per RUN, and a run attaches
 *    several skills, so each of its findings is credited to all of them. No
 *    table links an individual finding to the skill that caused it, making these
 *    an approximation — label them as such in the UI.
 */
export const SkillStats = z.object({
  agents_using: z.number().int(),
  runs: z.number().int(),
  pull_pct: z.number().nullable(),
  accept_rate: z.number().nullable(),
  findings: z.number().int(),
  by_category: z.array(SkillCategoryCount),
});
export type SkillStats = z.infer<typeof SkillStats>;

/** Cheap per-skill row for the list rail — one query covers the workspace. */
export const SkillStatsSummary = z.object({
  skill_id: z.string(),
  agents_using: z.number().int(),
  pull_pct: z.number().nullable(),
  accept_rate: z.number().nullable(),
});
export type SkillStatsSummary = z.infer<typeof SkillStatsSummary>;

/**
 * Advisory flags on an imported body — things a human should look at before
 * enabling the skill, since a skill body is untrusted text that ends up in a
 * model prompt.
 *
 * These are REVIEW AIDS, NOT A SECURITY BOUNDARY. Prompt-injection defense in
 * this codebase is the trusted-rule + untrusted-wrapper design in
 * reviewer-core/prompt.ts, never pattern matching (see server/CLAUDE.md) — any
 * phrasing these miss is expected, which is why imports also land disabled and
 * carry the "needs vetting" badge. Codes, not sentences, so the client owns the
 * wording:
 *  - html_markup           raw HTML tags in the body
 *  - hidden_text           HTML comments, or zero-width/bidi characters that
 *                          hide text from a human reading the preview
 *  - instruction_override  text addressed at the model rather than the reviewer
 *  - external_url          links off to another host (a possible exfil target)
 *  - credential_reference  mentions env vars / key-shaped strings
 *  - data_uri              embedded data: or base64 blobs
 *  - oversized             long enough to crowd out the rest of the prompt
 */
export const SkillImportWarning = z.enum([
  'html_markup',
  'hidden_text',
  'instruction_override',
  'external_url',
  'credential_reference',
  'data_uri',
  'oversized',
]);
export type SkillImportWarning = z.infer<typeof SkillImportWarning>;

/**
 * Result of POST /skills/import/preview. Persists nothing; `skipped` lists
 * archive entries that were read but ignored (scripts, binaries, extra
 * markdown files); `warnings` lists advisory risk flags on the body.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source: SkillSource,
  skipped: z.array(z.string()),
  warnings: z.array(SkillImportWarning),
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
