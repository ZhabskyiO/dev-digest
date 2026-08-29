import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    agentVersion: integer('agent_version').notNull().default(1),
    baseBranch: text('base_branch').notNull().default('main'),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    triggers: jsonb('triggers')
      .$type<string[]>()
      .notNull()
      .default(['opened', 'synchronize', 'reopened']),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ci_installations_agent_repo_uniq').on(t.agentId, t.repo),
    index('ci_installations_repo_idx').on(t.repo),
  ],
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    workflowRunId: text('workflow_run_id').notNull(),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    agent: text('agent'),
    durationS: doublePrecision('duration_s'),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('ci_runs_workflow_run_id_uniq').on(t.workflowRunId),
    index('ci_runs_installation_ran_at_idx').on(t.ciInstallationId, t.ranAt.desc()),
  ],
);
