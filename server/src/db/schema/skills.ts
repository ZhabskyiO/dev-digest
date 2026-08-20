import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type', { enum: ['rubric', 'convention', 'security', 'custom'] }).notNull(),
    source: text('source', {
      enum: ['manual', 'imported_url', 'extracted', 'community'],
    }).notNull(),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    evidenceFiles: jsonb('evidence_files').$type<string[]>(),
    createdAt: now(),
  },
  (t) => ({
    workspaceIdx: index('skills_workspace_id_idx').on(t.workspaceId),
  }),
);

/**
 * Immutable body snapshots. Written only when a skill's `body` actually changes,
 * so eval runs stay reproducible against the exact text they scored — which is
 * also why a restore appends a new snapshot instead of rewinding.
 * `label` is the author's optional "what changed" note for the version.
 */
export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    label: text('label'),
    // [T3] Project-context attachment snapshot (which docs were attached, in
    // what order) at the time this version was saved. Nullable on purpose —
    // rows written before this feature existed have none.
    attachments: jsonb('attachments'),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
