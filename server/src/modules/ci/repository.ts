import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  CiInstallation,
  CiPostAs,
  CiRun,
  CiRunListItem,
  CiRunsQuery,
  CiTarget,
  CiTrigger,
} from '@devdigest/shared';

/**
 * T9 — `ci` module data-access. The ONLY file under `modules/ci/**` that
 * imports `db/schema`/`drizzle-orm` — everything else (service, ingest,
 * routes) reaches the DB through the methods here.
 *
 * `ci_installations`/`ci_runs` carry no `workspace_id` of their own — the
 * only route to a workspace is `ci_installations.agent_id -> agents.workspace_id`.
 * Every workspace-scoped method below joins through `agents` for that reason.
 */

type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
type CiRunRow = typeof t.ciRuns.$inferSelect;

export interface UpsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: CiTarget;
  agentVersion: number;
  baseBranch: string;
  postAs: CiPostAs;
  triggers: CiTrigger[];
}

export interface UpsertRunInput {
  ciInstallationId: string | null;
  workflowRunId: string;
  prNumber?: number | null;
  ranAt?: Date | null;
  status: string | null;
  findingsCount?: number | null;
  costUsd?: number | null;
  githubUrl?: string | null;
  source?: string | null;
  agent?: string | null;
  durationS?: number | null;
  error?: string | null;
}

/** One installation row plus the pieces `CiService`/`CiIngestService` need to
 *  build a `CiInstallationStatus` — the newest run (if any) and the agent's
 *  CURRENT version (compared against `installation.agent_version` for the
 *  out-of-date flag, AC-8). */
export interface CiInstallationWithStatus {
  installation: CiInstallation;
  agentCurrentVersion: number;
  lastRun: CiRun | null;
}

const DEFAULT_LIST_LIMIT = 50;

const WINDOW_MS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function windowCutoff(window: '24h' | '7d' | '30d'): Date {
  return new Date(Date.now() - WINDOW_MS[window]);
}

function toCiInstallation(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType as CiTarget,
    installed_at: row.installedAt.toISOString(),
    agent_version: row.agentVersion,
    base_branch: row.baseBranch,
    post_as: row.postAs as CiPostAs,
    triggers: row.triggers as CiTrigger[],
  };
}

function toCiRun(row: CiRunRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agent,
    duration_s: row.durationS,
    error: row.error,
  };
}

export class CiRepository {
  constructor(private db: Db) {}

  /**
   * Every installation for a workspace (optionally narrowed to one agent),
   * each paired with the newest `ci_runs` row for it (if any) via a
   * `DISTINCT ON` query rather than a per-row lateral join — Drizzle 0.38's
   * pg-core query builder has no lateral-join helper, and the number of
   * installations per workspace is small enough that a second, indexed query
   * (`ci_runs_installation_ran_at_idx`) is simpler and just as cheap.
   */
  async listInstallations(
    workspaceId: string,
    agentId?: string,
  ): Promise<CiInstallationWithStatus[]> {
    const conditions = [eq(t.agents.workspaceId, workspaceId)];
    if (agentId) conditions.push(eq(t.ciInstallations.agentId, agentId));

    const installationRows = await this.db
      .select({ installation: t.ciInstallations, agentVersion: t.agents.version })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(...conditions))
      .orderBy(desc(t.ciInstallations.installedAt));

    if (installationRows.length === 0) return [];

    const ids = installationRows.map((r) => r.installation.id);
    const latestRuns = await this.db
      .selectDistinctOn([t.ciRuns.ciInstallationId], { run: t.ciRuns })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, ids))
      .orderBy(t.ciRuns.ciInstallationId, desc(t.ciRuns.ranAt));

    const runByInstallation = new Map<string, CiRunRow>();
    for (const { run } of latestRuns) {
      if (run.ciInstallationId) runByInstallation.set(run.ciInstallationId, run);
    }

    return installationRows.map(({ installation, agentVersion }) => ({
      installation: toCiInstallation(installation),
      agentCurrentVersion: agentVersion,
      lastRun: runByInstallation.has(installation.id)
        ? toCiRun(runByInstallation.get(installation.id)!)
        : null,
    }));
  }

  /**
   * Insert-or-update against the `(agent_id, repo)` unique index (AC-29).
   * A re-export for the SAME agent+repo (first install, or the AC-49/AC-50
   * "update" path, which reuses this same call) refreshes every wizard-owned
   * column plus `installed_at`/`updated_at`/`agent_version` — so an update
   * always reads back as a fresh install of the agent's current version.
   */
  async upsertInstallation(input: UpsertInstallationInput): Promise<CiInstallation> {
    const now = new Date();
    const values = {
      agentId: input.agentId,
      repo: input.repo,
      targetType: input.targetType,
      agentVersion: input.agentVersion,
      baseBranch: input.baseBranch,
      postAs: input.postAs,
      triggers: input.triggers,
      installedAt: now,
      updatedAt: now,
    };
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values(values)
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: {
          targetType: values.targetType,
          agentVersion: values.agentVersion,
          baseBranch: values.baseBranch,
          postAs: values.postAs,
          triggers: values.triggers,
          installedAt: values.installedAt,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return toCiInstallation(row!);
  }

  /**
   * The installation for `repo` in this workspace, WHATEVER agent owns it —
   * used for the one-agent-per-repo 409 check (A4) before a different agent
   * is allowed to install onto the same repo.
   */
  async findInstallationByRepo(
    workspaceId: string,
    repo: string,
  ): Promise<CiInstallation | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, repo)));
    return row ? toCiInstallation(row.installation) : undefined;
  }

  /**
   * Insert-or-update against the `workflow_run_id` unique index (AC-44) — at
   * most one row per GitHub workflow run, however many times ingest refreshes
   * it. `setWhere` only lets the update through while the STORED row is still
   * `running` (or has no status yet); once a row reaches a terminal status
   * (`succeeded`/`failed`/`no_findings`) a later upsert for the same run
   * becomes a no-op, so an out-of-order refresh can never regress a
   * terminal result back to a stale `running` snapshot.
   */
  async upsertRun(input: UpsertRunInput): Promise<void> {
    const values = {
      ciInstallationId: input.ciInstallationId ?? null,
      workflowRunId: input.workflowRunId,
      prNumber: input.prNumber ?? null,
      ranAt: input.ranAt ?? null,
      status: input.status ?? null,
      findingsCount: input.findingsCount ?? null,
      costUsd: input.costUsd ?? null,
      githubUrl: input.githubUrl ?? null,
      source: input.source ?? null,
      agent: input.agent ?? null,
      durationS: input.durationS ?? null,
      error: input.error ?? null,
    };
    await this.db
      .insert(t.ciRuns)
      .values(values)
      .onConflictDoUpdate({
        target: t.ciRuns.workflowRunId,
        set: {
          ciInstallationId: values.ciInstallationId,
          prNumber: values.prNumber,
          ranAt: values.ranAt,
          status: values.status,
          findingsCount: values.findingsCount,
          costUsd: values.costUsd,
          githubUrl: values.githubUrl,
          source: values.source,
          agent: values.agent,
          durationS: values.durationS,
          error: values.error,
        },
        setWhere: sql`${t.ciRuns.status} = 'running' OR ${t.ciRuns.status} IS NULL`,
      });
  }

  /**
   * Filtered, paginated CI Runs list (AC-46). Deliberately a LEFT JOIN —
   * `ci_installation_id` goes `NULL` (never a dangling reference) when its
   * installation is deleted, and an INNER JOIN would silently drop that run
   * off the CI Runs page instead of just losing its repo/agent labels.
   *
   * Caveat worth flagging forward: because `ci_runs` carries no
   * `workspace_id` of its own, a run whose installation has been deleted can
   * no longer be attributed to a workspace at all — the `OR
   * ci_installation_id IS NULL` half of the scope below is what keeps such a
   * row visible per the AC-44 "stays listed" requirement, but it also means
   * an orphaned run is visible from EVERY workspace's `/ci-runs` list, not
   * just the one that installed it. Closing that gap needs a `workspace_id`
   * column on `ci_runs` (a schema change outside this task's owned paths).
   */
  async listRuns(
    workspaceId: string,
    query: CiRunsQuery,
  ): Promise<{ items: CiRunListItem[]; total: number }> {
    const conditions = [or(eq(t.agents.workspaceId, workspaceId), isNull(t.ciRuns.ciInstallationId))];
    if (query.repo) conditions.push(eq(t.ciInstallations.repo, query.repo));
    if (query.agent_id) conditions.push(eq(t.ciInstallations.agentId, query.agent_id));
    if (query.status) conditions.push(eq(t.ciRuns.status, query.status));
    if (query.window && query.window !== 'all') {
      conditions.push(gte(t.ciRuns.ranAt, windowCutoff(query.window)));
    }
    const whereClause = and(...conditions);

    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const offset = query.offset ?? 0;

    const [rows, countRows] = await Promise.all([
      this.db
        .select({ run: t.ciRuns, repo: t.ciInstallations.repo, agentId: t.ciInstallations.agentId })
        .from(t.ciRuns)
        .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
        .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
        .where(whereClause)
        .orderBy(desc(t.ciRuns.ranAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(t.ciRuns)
        .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
        .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
        .where(whereClause),
    ]);

    return {
      items: rows.map(({ run, repo, agentId }) => ({
        ...toCiRun(run),
        repo: repo ?? null,
        agent_id: agentId ?? null,
      })),
      total: countRows[0]?.n ?? 0,
    };
  }

  /**
   * Current stored status per `workflow_run_id` — lets ingest skip a
   * download entirely for a run it already recorded as terminal, without
   * fetching the full row.
   */
  async getRunStatuses(workflowRunIds: string[]): Promise<Map<string, string | null>> {
    if (workflowRunIds.length === 0) return new Map();
    const rows = await this.db
      .select({ workflowRunId: t.ciRuns.workflowRunId, status: t.ciRuns.status })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.workflowRunId, workflowRunIds));
    return new Map(rows.map((r) => [r.workflowRunId, r.status]));
  }
}
