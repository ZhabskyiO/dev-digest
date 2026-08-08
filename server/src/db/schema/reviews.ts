import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import type { IntentSource } from '@devdigest/shared';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  // The PR list groups findings by (pr, severity) through this FK on every
  // page load; without the index that join seq-scans the whole table.
  (t) => ({ reviewIdx: index('findings_review_idx').on(t.reviewId) }),
);

export const prIntent = pgTable(
  'pr_intent',
  {
    prId: uuid('pr_id')
      .primaryKey()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    intent: text('intent').notNull(),
    inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /**
     * The commit this row was derived from. Defaults to `''`, never to a real
     * sha — `''` can never equal a real `pull_requests.head_sha`, so any
     * pre-existing row (or a row inserted before this column existed) is a
     * guaranteed cache miss and gets re-derived rather than silently reused.
     */
    headSha: text('head_sha').notNull().default(''),
    /**
     * TEXT + CHECK, not a PG enum: this may gain a tier later, and extending a
     * `CREATE TYPE` needs its own migration, while a CHECK is a single ALTER.
     */
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull().default('low'),
    confidenceScore: doublePrecision('confidence_score').notNull().default(0.3),
    sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    /**
     * Nullable: null means "unknown price", rendered as `—` and never `$0.00` —
     * same rule as `agent_runs.cost_usd` / `RunStats.cost_usd`.
     */
    costUsd: doublePrecision('cost_usd'),
    derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
    // No index on head_sha: the only access path is `WHERE pr_id = $1`, already
    // served by the PK above; the sha is compared in application code after
    // that lookup. An index here would be pure write overhead.
    // No history table: the PK stays `pr_id`, so a re-derive overwrites — one
    // PR has exactly one current intent.
  },
  (t) => [
    // Declared here (not hand-appended to a migration) so `pnpm db:generate`
    // and its snapshot stay the source of truth for this constraint.
    check('pr_intent_confidence_chk', sql`${t.confidence} IN ('high','medium','low')`),
  ],
);

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
