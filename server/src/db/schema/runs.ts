import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { skills } from './skills';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /**
     * Run cost in USD. Real billed cost from OpenRouter's `usage.cost` when
     * available, else priced from tokens. NULL when the model has no known price
     * or the run failed — the UI renders `—`, never `$0.00`.
     */
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
    /**
     * Links this run to the multi-agent run that spawned it (multi-agent review
     * feature). `ON DELETE SET NULL` is deliberate: deleting a multi-run must
     * never delete the agent runs' own history.
     */
    multiRunId: uuid('multi_run_id').references(() => multiAgentRuns.id, {
      onDelete: 'set null',
    }),
    /**
     * Findings this run's model proposed but which failed the grounding gate
     * (didn't cite a real diff line) — surfaced as "did not flag" notes in the
     * multi-agent disagreement view (AC-50). Populated from `outcome.dropped`
     * on the success path.
     */
    groundingRejected: jsonb('grounding_rejected').$type<
      { file: string; start_line: number; end_line: number; title: string; reason: string }[]
    >(),
  },
  (t) => ({
    multiRunIdx: index('agent_runs_multi_run_id_idx').on(t.multiRunId),
    prStatusIdx: index('agent_runs_pr_status_idx').on(t.prId, t.status),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable(
  'multi_agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    prRanAtIdx: index('multi_agent_runs_pr_ran_at_idx').on(t.prId, t.ranAt),
  }),
);

export const runSkills = pgTable(
  'run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.skillId] }),
    skillIdx: index('run_skills_skill_id_idx').on(t.skillId),
  }),
);
