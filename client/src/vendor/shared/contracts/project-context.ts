import { z } from 'zod';

/**
 * Project context: specs/docs/insights markdown discovered under a target
 * repository's clone, previewed, and (opt-in) attached to an agent or a
 * skill so its body is injected into the review prompt as untrusted
 * context. See specs/2026-08-18-project-context.md.
 *
 * Document text itself is NEVER persisted for an attachment (AC-12) — only
 * a content hash / size / revision, which is what makes drift detection
 * possible without storing a body (AC-35, AC-38).
 */

export const ProjectContextDocType = z.enum(['specs', 'docs', 'insights']);
export type ProjectContextDocType = z.infer<typeof ProjectContextDocType>;

/**
 * One (agent or skill) that has this document attached and whose attached
 * hash currently differs from the document's content hash — i.e. one entry
 * of AC-36's drift, named with the exact `{owner_kind, owner_id}` shape the
 * drift-detail (AC-38) and confirm (AC-37) endpoints already take, so a
 * document-list consumer can act on a drift without a per-document
 * round-trip to discover who it belongs to.
 */
export const ProjectContextDriftOwner = z.object({
  owner_kind: z.enum(['agent', 'skill']),
  owner_id: z.string(),
  owner_name: z.string(),
});
export type ProjectContextDriftOwner = z.infer<typeof ProjectContextDriftOwner>;

/** One discovered document — list/discovery shape, no body (AC-9, AC-10). */
export const ProjectContextDocument = z.object({
  /** Clone-relative path. */
  path: z.string(),
  type: ProjectContextDocType,
  size_bytes: z.number().int(),
  content_hash: z.string(),
  /** Estimated token count (AC-9) — an approximation, not an exact count. */
  tokens: z.number().int(),
  /** How many agents currently have this document attached (AC-11). */
  used_by_agents: z.number().int(),
  /** Set when this document is attached somewhere and its current content
   *  hash differs from the hash recorded at attach time (AC-36). */
  drift: z.boolean().optional(),
  /** Who this document is currently drifted for (AC-37/AC-38 reachability
   *  from the repo-level document list, no N+1 fan-out). `.default([])`,
   *  not required, so shapes cached/persisted before this field existed
   *  still parse. */
  drifted_for: z.array(ProjectContextDriftOwner).default([]),
});
export type ProjectContextDocument = z.infer<typeof ProjectContextDocument>;

/** GET .../preview response — adds the markdown body (capped) and whether
 *  it was truncated to fit that cap (AC-10, AC-24). */
export const ProjectContextPreview = ProjectContextDocument.extend({
  body: z.string(),
  truncated: z.boolean(),
});
export type ProjectContextPreview = z.infer<typeof ProjectContextPreview>;

/** Counters for entries dropped by the count / size discovery caps (AC-5). */
export const ProjectContextOmitted = z.object({
  by_count: z.number().int(),
  by_size: z.number().int(),
});
export type ProjectContextOmitted = z.infer<typeof ProjectContextOmitted>;

/** GET project-context list response for one repository (AC-1..AC-8). */
export const ProjectContextListResponse = z.object({
  documents: z.array(ProjectContextDocument),
  /** Set when the repository has no clone yet (AC-4); `documents` is empty
   *  and this is the only signal for why. */
  reason: z.literal('not_cloned').optional(),
  omitted: ProjectContextOmitted.optional(),
  /** Timestamp of the discovery walk that produced this list. */
  scanned_at: z.string(),
  /** Root directories the walk scanned, e.g. `specs/`, `docs/`, `insights/`. */
  roots: z.array(z.string()),
  /** Conventional filenames recognised outside the roots (e.g. root README). */
  conventional_filenames: z.array(z.string()),
  /** The configured project-context token budget (AC-40). */
  budget_tokens: z.number().int(),
  /**
   * HEAD sha of the clone this walk actually read, or null when there is no
   * clone (AC-4) or its HEAD could not be resolved. The documents below come
   * from THIS revision — without it an empty list is indistinguishable from a
   * stale checkout that simply predates the directories the user is looking
   * for.
   */
  clone_head: z.string().nullable(),
  /**
   * Set only when a rescan's pre-scan fetch from origin failed. The walk still
   * ran, so `documents` reflects whatever the (now possibly stale) clone still
   * holds — a fetch failure degrades the refresh, it never fails the rescan.
   */
  sync_error: z.string().optional(),
});
export type ProjectContextListResponse = z.infer<typeof ProjectContextListResponse>;

/**
 * A reference to one document, repository-scoped (documents are
 * repository-scoped; agents and skills are not — AC-25). Used both as the
 * attach-request shape and as the persisted ordered list on an agent/skill
 * version snapshot.
 */
export const ProjectContextRef = z.object({
  repo_id: z.string(),
  path: z.string(),
});
export type ProjectContextRef = z.infer<typeof ProjectContextRef>;

/**
 * A persisted attachment. Stores no document text (AC-12) — the recorded
 * hash/size/revision are what make the drift comparison possible without a
 * body (AC-35, AC-38). Which agent or skill owns this attachment is carried
 * by the storing table/route, not this shape.
 */
export const ProjectContextAttachment = z.object({
  repo_id: z.string(),
  path: z.string(),
  /** Defines prompt order (AC-14). */
  order: z.number().int(),
  /** Content hash at attach time (AC-35). */
  attached_hash: z.string(),
  /** Size in bytes at attach time (AC-35). */
  attached_size: z.number().int(),
  /** The clone's commit revision at attach time (AC-35, AC-38). */
  attached_revision: z.string(),
  /** Set when the current content hash differs from `attached_hash` (AC-36). */
  drift: z.boolean().optional(),
});
export type ProjectContextAttachment = z.infer<typeof ProjectContextAttachment>;

/**
 * GET drift detail response (AC-38). `previous` is absent when the
 * attach-time revision is no longer resolvable in the clone (force-push,
 * GC) — drift review degrades to showing only the current content plus
 * `previous_unavailable`, and confirmation still works.
 */
export const ProjectContextDrift = z.object({
  path: z.string(),
  attached_revision: z.string(),
  previous: z.string().optional(),
  current: z.string(),
  previous_unavailable: z.boolean(),
});
export type ProjectContextDrift = z.infer<typeof ProjectContextDrift>;

/** Where one document in an agent's effective context set came from — a
 *  direct attachment, or one inherited via a linked, globally-enabled
 *  skill (AC-16). */
export const ProjectContextSource = z.enum(['agent', 'skill']);
export type ProjectContextSource = z.infer<typeof ProjectContextSource>;

export const EffectiveProjectContextDoc = z.object({
  repo_id: z.string(),
  path: z.string(),
  type: ProjectContextDocType,
  tokens: z.number().int(),
  source: ProjectContextSource,
  /** Set when `source` is `'skill'`. */
  skill_id: z.string().optional(),
  drift: z.boolean().optional(),
});
export type EffectiveProjectContextDoc = z.infer<typeof EffectiveProjectContextDoc>;

/** An agent's effective context set: own attachments followed by linked,
 *  globally-enabled skills' attachments, de-duplicated by (repo, path),
 *  keeping the first occurrence's position (AC-16, AC-17, AC-40). */
export const EffectiveProjectContext = z.object({
  documents: z.array(EffectiveProjectContextDoc),
  total_tokens: z.number().int(),
  /** The configured project-context budget the total is measured against. */
  budget_tokens: z.number().int(),
  over_budget: z.boolean(),
  /** Ordered paths that would not be injected under the current budget
   *  (AC-40) — the same tail, in the same order, AC-23's run-time drop
   *  would produce. */
  dropped_paths: z.array(z.string()),
});
export type EffectiveProjectContext = z.infer<typeof EffectiveProjectContext>;

/** Per-document run-time outcome persisted in the run trace (AC-29). */
export const ProjectContextOutcome = z.enum([
  'injected',
  'missing',
  'dropped_over_budget',
  'truncated',
  'wrong_repo',
  'changed_unconfirmed',
]);
export type ProjectContextOutcome = z.infer<typeof ProjectContextOutcome>;

/** One row of the run trace's project-context detail array (AC-29, AC-30). */
export const ProjectContextTraceItem = z.object({
  path: z.string(),
  tokens: z.number().int(),
  outcome: ProjectContextOutcome,
  truncated: z.boolean().optional(),
  /** Set when the injected content differed from the attached hash at run
   *  time, i.e. the document drifted (mirrors `outcome: 'changed_unconfirmed'`
   *  when the drift was NOT confirmed before the run — AC-44). */
  changed: z.boolean().optional(),
});
export type ProjectContextTraceItem = z.infer<typeof ProjectContextTraceItem>;
