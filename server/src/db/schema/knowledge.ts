import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, integer, vector, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * Extracted house-rules awaiting review. `accepted` predates the review flow and
 * is kept in lockstep with `status` (true iff 'accepted') because the plugin
 * export path reads it; only `status` can express a *rejection*, which is what
 * `ruleKey` then uses to keep a rejected rule from being re-suggested by the
 * next scan (the unique index makes that a DB-level guarantee, not a race).
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    category: text('category', {
      enum: [
        'naming',
        'structure',
        'error-handling',
        'testing',
        'typing',
        'imports',
        'api-design',
        'styling',
        'other',
      ],
    })
      .notNull()
      .default('other'),
    rule: text('rule').notNull(),
    /** Normalized `rule`, the dedupe key. */
    ruleKey: text('rule_key').notNull().default(''),
    evidencePath: text('evidence_path'),
    evidenceLine: integer('evidence_line'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    accepted: boolean('accepted').notNull().default(false),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => ({
    repoIdx: index('conventions_repo_idx').on(t.repoId),
    ruleUq: uniqueIndex('conventions_repo_rule_key_uq').on(t.repoId, t.ruleKey),
  }),
);
