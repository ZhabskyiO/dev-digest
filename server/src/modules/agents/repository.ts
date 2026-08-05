import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.agentSkills)
      .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
  }

  // ---- run stats (AgentCard summary row + editor Stats tab tiles) ---------

  /**
   * Raw aggregates for one agent's runs, optionally windowed to the last
   * `days` days. Two queries rather than one: `avg(cost)`/`avg(duration)`
   * must run over ALL of the agent's runs (including ones with no review —
   * e.g. still-failed), while accept rate must run over only the runs that
   * produced a review (an inner join to `reviews`), so a single query would
   * either drop cost/duration for unreviewed runs or double-count something.
   */
  async runStats(agentId: string, days?: number): Promise<AgentRunStatsRaw> {
    const conditions = [eq(t.agentRuns.agentId, agentId)];
    if (days !== undefined) {
      conditions.push(gte(t.agentRuns.ranAt, new Date(Date.now() - days * 86400000)));
    }

    const [totals] = await this.db
      .select({
        runs: sql<number>`count(*)`.mapWith(Number),
        // avg() over zero/all-null rows returns SQL NULL, not 0 — mapWith
        // keeps that null through to JS rather than coercing to 0.
        avgCostUsd: sql<number | null>`avg(${t.agentRuns.costUsd})`.mapWith((v) =>
          v === null ? null : Number(v),
        ),
        avgDurationMs: sql<number | null>`avg(${t.agentRuns.durationMs})`.mapWith((v) =>
          v === null ? null : Number(v),
        ),
      })
      .from(t.agentRuns)
      .where(and(...conditions));

    const [accept] = await this.db
      .select({
        reviewed: sql<number>`count(*)`.mapWith(Number),
        approved: sql<number>`count(*) filter (where ${t.reviews.verdict} = 'approve')`.mapWith(
          Number,
        ),
      })
      .from(t.agentRuns)
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .where(and(...conditions));

    return {
      runs: totals?.runs ?? 0,
      avgCostUsd: totals?.avgCostUsd ?? null,
      avgDurationMs: totals?.avgDurationMs ?? null,
      reviewedRuns: accept?.reviewed ?? 0,
      approvedRuns: accept?.approved ?? 0,
    };
  }

  /**
   * Daily run counts, oldest first, over the last `days` days — the TOTAL
   * RUNS tile's sparkline. Buckets in JS from raw `ran_at` timestamps rather
   * than a SQL `date_trunc`/`group by`, so there is no driver-specific date
   * string format to parse and days with zero runs still get an explicit 0
   * bucket (a SQL group-by would just omit them, breaking the even spacing
   * `Sparkline` assumes).
   */
  async dailyRunCounts(agentId: string, days: number): Promise<number[]> {
    const now = Date.now();
    const cutoff = new Date(now - days * 86400000);
    const rows = await this.db
      .select({ ranAt: t.agentRuns.ranAt })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agentId), gte(t.agentRuns.ranAt, cutoff)));

    const counts = new Array<number>(days).fill(0);
    for (const row of rows) {
      const ageDays = Math.floor((now - row.ranAt.getTime()) / 86400000);
      const idx = days - 1 - ageDays; // oldest bucket at index 0
      if (idx >= 0 && idx < days) counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * `avg(cost)` over the last `days` days minus `avg(cost)` over the
   * immediately preceding window of equal length — the signed delta shown
   * next to the AVG COST/RUN tile. `null` when either window has no priced
   * run to average (a fresh agent, or one with too little history yet).
   */
  async avgCostDelta(agentId: string, days: number): Promise<number | null> {
    const now = Date.now();
    const currentCutoff = new Date(now - days * 86400000);
    const previousCutoff = new Date(now - days * 2 * 86400000);

    const avgCostWhere = (from: Date, to?: Date) =>
      this.db
        .select({
          avg: sql<number | null>`avg(${t.agentRuns.costUsd})`.mapWith((v) =>
            v === null ? null : Number(v),
          ),
        })
        .from(t.agentRuns)
        .where(
          to
            ? and(eq(t.agentRuns.agentId, agentId), gte(t.agentRuns.ranAt, from), lt(t.agentRuns.ranAt, to))
            : and(eq(t.agentRuns.agentId, agentId), gte(t.agentRuns.ranAt, from)),
        );

    const [[current], [previous]] = await Promise.all([
      avgCostWhere(currentCutoff),
      avgCostWhere(previousCutoff, currentCutoff),
    ]);

    if (current?.avg == null || previous?.avg == null) return null;
    return current.avg - previous.avg;
  }
}

/** Raw shape returned by {@link AgentsRepository.runStats}; the service turns
 *  this into the public `AgentRunStats` DTO (accept-rate percentage math). */
export interface AgentRunStatsRaw {
  runs: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  reviewedRuns: number;
  approvedRuns: number;
}
