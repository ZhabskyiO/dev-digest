import { and, desc, eq, gte, sql } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`. Never writes
 * `agent_skills` — the link/reorder/list methods for that table already exist
 * on `AgentsRepository` (agents module owns the agent side); this repository
 * only reads it in reverse (`agentIdsForSkill`) and owns the skill-usage
 * aggregation (`usageByAgent`, `skillUsingRunCount`) since that rollup is
 * skill-owned per spec. Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  /** Files the skill's rules were extracted from — set by convention extraction. */
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  /** "What changed" note, recorded only when this patch snapshots a new body. */
  versionLabel?: string;
}

/** One row of the per-agent skill-usage rollup, pre-DTO/pre-pct. */
export interface SkillUsageRow {
  skillId: string;
  name: string;
  type: SkillType;
  runs: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). agent_skills rows cascade via FK,
   *  nothing extra to do. Returns false if no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: 1,
        ...(values.evidenceFiles ? { evidenceFiles: values.evidenceFiles } : {}),
      })
      .returning();
    await this.snapshotVersion(row!, 1);
    return row!;
  }

  /**
   * Update a skill. Only a change to `body` bumps the version and snapshots the
   * new body into skill_versions (reproducibility for eval) — toggling `enabled`
   * or editing name/description/type/source alone does not.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // `isConfigChange` from ./helpers.js was not present yet when this was written;
    // inlined here (same one-line check the spec describes) — swap for the shared
    // helper once it lands.
    const configChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    // A label with no body change has nowhere to live — no snapshot is written,
    // so it is dropped rather than attached to the previous version.
    if (configChanged && row) await this.snapshotVersion(row, nextVersion, patch.versionLabel);
    return row;
  }

  private async snapshotVersion(
    row: SkillRow,
    version: number,
    label?: string,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({
        skillId: row.id,
        version,
        body: row.body,
        ...(label ? { label } : {}),
      })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- read-only rollups over agent_skills / run_skills --------------------

  /** Distinct agent ids this skill is linked to — the reverse of AgentsRepository.linkedSkills,
   *  behind GET /skills/:id/agents. */
  async agentIdsForSkill(skillId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    return rows.map((r) => r.agentId);
  }

  /**
   * Per-skill usage for one agent over the last `days` days: how many of the
   * agent's runs (in that window) included each skill. Joins run_skills →
   * agent_runs (scoped to agentId + ran_at cutoff) → skills, grouped by skill,
   * counting DISTINCT run_skills.run_id as `runs`. The service layer turns
   * these raw rows into the SkillUsage DTO with the pct math (percentage
   * against `skillUsingRunCount`, not the agent's total run count — see there).
   */
  async usageByAgent(agentId: string, days: number): Promise<SkillUsageRow[]> {
    const cutoff = new Date(Date.now() - days * 86400000);
    const rows = await this.db
      .select({
        skillId: t.skills.id,
        name: t.skills.name,
        type: t.skills.type,
        runs: sql<number>`count(distinct ${t.runSkills.runId})`.mapWith(Number),
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .innerJoin(t.skills, eq(t.runSkills.skillId, t.skills.id))
      .where(and(eq(t.agentRuns.agentId, agentId), gte(t.agentRuns.ranAt, cutoff)))
      .groupBy(t.skills.id, t.skills.name, t.skills.type);
    return rows as SkillUsageRow[];
  }

  /**
   * The usage-panel denominator: COUNT(DISTINCT run_id) in run_skills joined to
   * agent_runs, filtered to this agent and time window. This is deliberately
   * NOT the agent's total run count — runs before this feature shipped (or any
   * run where the agent had zero enabled skills attached) have no run_skills
   * rows and would otherwise read as a misleading 0%. It answers "how many of
   * this agent's runs had at least one enabled skill attached", i.e. the share
   * of *skill-using* runs that included a given skill — label accordingly in
   * the UI rather than implying it's a share of all runs.
   */
  async skillUsingRunCount(agentId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400000);
    const [row] = await this.db
      .select({ count: sql<number>`count(distinct ${t.runSkills.runId})`.mapWith(Number) })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .where(and(eq(t.agentRuns.agentId, agentId), gte(t.agentRuns.ranAt, cutoff)));
    return row?.count ?? 0;
  }

  /**
   * Per-run attribution write: one `run_skills` row per skill id, `order` =
   * its index in the (already-ordered) array. Called once per run, right
   * after the executor resolves the agent's enabled linked skills. No-op on
   * an empty list — never issue a zero-row INSERT.
   */
  async recordRunSkills(runId: string, skillIds: string[]): Promise<void> {
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.runSkills)
      .values(skillIds.map((skillId, order) => ({ runId, skillId, order })));
  }

  // ---- per-skill stats -----------------------------------------------------
  //
  // Raw numerators and denominators only; the ratio and null-handling math is
  // the service's job (same split as AgentsRepository.runStats).
  //
  // Everything findings-related walks
  //   findings → reviews (review_id) → agent_runs (reviews.run_id) → run_skills
  // `reviews.run_id` is nullable and carries no FK, so a review that was never
  // linked to a run drops out of these joins. That is correct: an unattributed
  // review can't be credited to a skill.

  /** How many agents have this skill attached (configuration, not runs). */
  async agentsUsingCount(skillId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    return row?.count ?? 0;
  }

  /** Distinct runs in the window that pulled this skill (the `pull_pct`
   *  numerator; `workspaceSkillUsingRuns` is the denominator). */
  async skillRunCount(workspaceId: string, skillId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400000);
    const [row] = await this.db
      .select({ count: sql<number>`count(distinct ${t.runSkills.runId})`.mapWith(Number) })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.runSkills.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, cutoff),
        ),
      );
    return row?.count ?? 0;
  }

  /**
   * Findings from runs that pulled this skill, split by triage state. A finding
   * is accepted, dismissed, or untouched — so the accept-rate denominator is
   * `accepted + dismissed`, never `total` (dividing by total would read every
   * untriaged finding as a rejection).
   */
  async skillFindingCounts(
    workspaceId: string,
    skillId: string,
    days: number,
  ): Promise<{ total: number; accepted: number; dismissed: number }> {
    const cutoff = new Date(Date.now() - days * 86400000);
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)`.mapWith(Number),
        dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)`.mapWith(Number),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.runSkills, eq(t.runSkills.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.runSkills.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, cutoff),
        ),
      );
    return {
      total: row?.total ?? 0,
      accepted: row?.accepted ?? 0,
      dismissed: row?.dismissed ?? 0,
    };
  }

  /** Findings-by-category for this skill. `category` is free text in the DB, so
   *  callers must not assume only the five contract values appear. */
  async skillFindingsByCategory(
    workspaceId: string,
    skillId: string,
    days: number,
  ): Promise<{ category: string; count: number }[]> {
    const cutoff = new Date(Date.now() - days * 86400000);
    const rows = await this.db
      .select({
        category: t.findings.category,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.runSkills, eq(t.runSkills.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.runSkills.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, cutoff),
        ),
      )
      .groupBy(t.findings.category)
      .orderBy(desc(sql`count(*)`));
    return rows;
  }

  /**
   * The same aggregates for EVERY skill in the workspace, for the list rail —
   * four grouped queries stitched in JS, rather than N per-card HTTP requests.
   * Skills with no runs/agents still get a row (zeros), because a left join
   * would drop them and the rail must show every skill.
   */
  async skillSummaries(
    workspaceId: string,
    days: number,
  ): Promise<
    {
      skillId: string;
      agentsUsing: number;
      runs: number;
      accepted: number;
      dismissed: number;
    }[]
  > {
    const cutoff = new Date(Date.now() - days * 86400000);

    const agentCounts = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.agentSkills.skillId);

    const runCounts = await this.db
      .select({
        skillId: t.runSkills.skillId,
        count: sql<number>`count(distinct ${t.runSkills.runId})`.mapWith(Number),
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), gte(t.agentRuns.ranAt, cutoff)))
      .groupBy(t.runSkills.skillId);

    const findingCounts = await this.db
      .select({
        skillId: t.runSkills.skillId,
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)`.mapWith(Number),
        dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)`.mapWith(Number),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.runSkills, eq(t.runSkills.runId, t.agentRuns.id))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), gte(t.agentRuns.ranAt, cutoff)))
      .groupBy(t.runSkills.skillId);

    const skillIds = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));

    const agentMap = new Map(agentCounts.map((r) => [r.skillId, r.count]));
    const runMap = new Map(runCounts.map((r) => [r.skillId, r.count]));
    const findingMap = new Map(findingCounts.map((r) => [r.skillId, r]));

    return skillIds.map(({ id }) => {
      const f = findingMap.get(id);
      return {
        skillId: id,
        agentsUsing: agentMap.get(id) ?? 0,
        runs: runMap.get(id) ?? 0,
        accepted: f?.accepted ?? 0,
        dismissed: f?.dismissed ?? 0,
      };
    });
  }

  /** Workspace-wide skill-using run count — the shared `pull_pct` denominator. */
  async workspaceSkillUsingRuns(workspaceId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400000);
    const [row] = await this.db
      .select({ count: sql<number>`count(distinct ${t.runSkills.runId})`.mapWith(Number) })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), gte(t.agentRuns.ranAt, cutoff)));
    return row?.count ?? 0;
  }
}
