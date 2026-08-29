/**
 * `CiRepository` — DB-backed (real Postgres via `test/helpers/pg.ts`, hence
 * `.it.test.ts` per `server/CLAUDE.md`'s unit/integration split).
 *
 * Proves the three persistence claims T9 owns:
 *  - AC-29/AC-28: `upsertInstallation` is a true upsert keyed on
 *    `(agent_id, repo)` — a second call for the same pair updates the ONE
 *    existing row (refreshed `installed_at`/`agent_version`), never inserts
 *    a second.
 *  - AC-44: `upsertRun` is a true upsert keyed on `workflow_run_id` — three
 *    calls for the same run leave exactly one `ci_runs` row, and a later
 *    call cannot regress an already-terminal row back to `running`.
 *  - The `listRuns` LEFT JOIN edge case: a run whose installation was
 *    deleted (`ci_installation_id` set NULL by the FK's `ON DELETE SET
 *    NULL`) still comes back from `listRuns` instead of vanishing.
 *  - `listRuns`'s four filters (window, agent, repo, status) each narrow the
 *    result set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import * as t from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import { CiRepository } from './repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-repository] Docker not available — skipping integration tests.');
}

let seq = 0;
function uniqueRepo(): string {
  seq += 1;
  return `acme/ci-repo-${seq}`;
}

async function insertWorkspace(db: Db, name: string): Promise<string> {
  const [row] = await db.insert(t.workspaces).values({ name }).returning({ id: t.workspaces.id });
  return row!.id;
}

async function insertAgent(
  db: Db,
  workspaceId: string,
  overrides: Partial<{ name: string; version: number }> = {},
): Promise<string> {
  const [row] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: overrides.name ?? 'CI Repo Test Agent',
      provider: 'openai',
      model: 'gpt-test',
      systemPrompt: 'Review this PR.',
      ...(overrides.version !== undefined ? { version: overrides.version } : {}),
    })
    .returning({ id: t.agents.id });
  return row!.id;
}

d('CiRepository', () => {
  let pg: PgFixture;
  let repo: CiRepository;
  let workspaceA: string;
  let workspaceB: string;

  beforeAll(async () => {
    pg = await startPg();
    repo = new CiRepository(pg.handle.db);
    workspaceA = await insertWorkspace(pg.handle.db, 'ci-repo-it-ws-a');
    workspaceB = await insertWorkspace(pg.handle.db, 'ci-repo-it-ws-b');
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-29/AC-28: two upsertInstallation calls for the same agent+repo leave exactly one row, with a refreshed timestamp and version', async () => {
    const agentId = await insertAgent(pg.handle.db, workspaceA);
    const repoName = uniqueRepo();

    const first = await repo.upsertInstallation({
      agentId,
      repo: repoName,
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened', 'synchronize'],
    });
    expect(first.agent_version).toBe(1);

    await new Promise((r) => setTimeout(r, 10)); // ensure a measurably later installed_at

    const second = await repo.upsertInstallation({
      agentId,
      repo: repoName,
      targetType: 'gha',
      agentVersion: 2,
      baseBranch: 'develop',
      postAs: 'pr_comment',
      triggers: ['opened', 'synchronize', 'reopened'],
    });

    expect(second.id).toBe(first.id);
    expect(second.agent_version).toBe(2);
    expect(second.base_branch).toBe('develop');
    expect(second.post_as).toBe('pr_comment');
    expect(new Date(second.installed_at).getTime()).toBeGreaterThan(
      new Date(first.installed_at).getTime(),
    );

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(sqlEqAgentRepo(agentId, repoName));
    expect(rows).toHaveLength(1);
  });

  it('findInstallationByRepo returns the installation whatever agent owns it, scoped to the workspace', async () => {
    const agentId = await insertAgent(pg.handle.db, workspaceA);
    const repoName = uniqueRepo();
    await repo.upsertInstallation({
      agentId,
      repo: repoName,
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened'],
    });

    const found = await repo.findInstallationByRepo(workspaceA, repoName);
    expect(found?.agent_id).toBe(agentId);

    // Not visible from a different workspace.
    const notFound = await repo.findInstallationByRepo(workspaceB, repoName);
    expect(notFound).toBeUndefined();
  });

  it('AC-44: three upsertRun calls for the same workflow_run_id leave exactly one row', async () => {
    const agentId = await insertAgent(pg.handle.db, workspaceA);
    const installation = await repo.upsertInstallation({
      agentId,
      repo: uniqueRepo(),
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened'],
    });
    const workflowRunId = `wf-${Date.now()}-${Math.random()}`;

    await repo.upsertRun({
      ciInstallationId: installation.id,
      workflowRunId,
      status: 'running',
      ranAt: new Date(),
    });
    await repo.upsertRun({
      ciInstallationId: installation.id,
      workflowRunId,
      status: 'running',
      ranAt: new Date(),
    });
    await repo.upsertRun({
      ciInstallationId: installation.id,
      workflowRunId,
      status: 'succeeded',
      findingsCount: 3,
      costUsd: 0.02,
      ranAt: new Date(),
    });

    const rows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(sqlEqWorkflowRunId(workflowRunId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('succeeded');
    expect(rows[0]?.findingsCount).toBe(3);

    // A later upsert MUST NOT regress an already-terminal row back to running.
    await repo.upsertRun({
      ciInstallationId: installation.id,
      workflowRunId,
      status: 'running',
    });
    const afterStaleRefresh = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(sqlEqWorkflowRunId(workflowRunId));
    expect(afterStaleRefresh).toHaveLength(1);
    expect(afterStaleRefresh[0]?.status).toBe('succeeded');
  });

  it('getRunStatuses reports the stored status per workflow_run_id and skips ids never ingested', async () => {
    const agentId = await insertAgent(pg.handle.db, workspaceA);
    const installation = await repo.upsertInstallation({
      agentId,
      repo: uniqueRepo(),
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened'],
    });
    const known = `wf-known-${Date.now()}`;
    const unknown = `wf-unknown-${Date.now()}`;
    await repo.upsertRun({ ciInstallationId: installation.id, workflowRunId: known, status: 'succeeded' });

    const statuses = await repo.getRunStatuses([known, unknown]);
    expect(statuses.get(known)).toBe('succeeded');
    expect(statuses.has(unknown)).toBe(false);
  });

  it('listRuns keeps a run listed after its installation is deleted (LEFT JOIN, not INNER JOIN)', async () => {
    const agentId = await insertAgent(pg.handle.db, workspaceA);
    const repoName = uniqueRepo();
    const installation = await repo.upsertInstallation({
      agentId,
      repo: repoName,
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened'],
    });
    const workflowRunId = `wf-orphan-${Date.now()}`;
    await repo.upsertRun({
      ciInstallationId: installation.id,
      workflowRunId,
      status: 'succeeded',
      findingsCount: 1,
      ranAt: new Date(),
    });

    // Delete the installation — `ci_installation_id` is FK `ON DELETE SET
    // NULL`, so the run row survives but loses its link (and, with it, the
    // ability to resolve a repo/agent label — see the repository's own
    // doc comment on `listRuns`).
    await pg.handle.db.delete(t.ciInstallations).where(sqlEqId(installation.id));

    const byRun = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(sqlEqWorkflowRunId(workflowRunId));
    expect(byRun).toHaveLength(1);
    expect(byRun[0]?.ciInstallationId).toBeNull();

    const { items } = await repo.listRuns(workspaceA, {});
    const found = items.find((i) => i.id === byRun[0]!.id);
    expect(found).toBeDefined();
    expect(found?.repo).toBeNull();
    expect(found?.agent_id).toBeNull();
  });

  it('listRuns filters: window, agent, repo, and status each narrow the result set', async () => {
    const agentId1 = await insertAgent(pg.handle.db, workspaceA, { name: 'Filter Agent 1' });
    const agentId2 = await insertAgent(pg.handle.db, workspaceA, { name: 'Filter Agent 2' });
    const repo1 = uniqueRepo();
    const repo2 = uniqueRepo();

    const inst1 = await repo.upsertInstallation({
      agentId: agentId1,
      repo: repo1,
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened'],
    });
    const inst2 = await repo.upsertInstallation({
      agentId: agentId2,
      repo: repo2,
      targetType: 'gha',
      agentVersion: 1,
      baseBranch: 'main',
      postAs: 'github_review',
      triggers: ['opened'],
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago

    await repo.upsertRun({
      ciInstallationId: inst1.id,
      workflowRunId: `wf-filter-recent-succeeded-${Date.now()}`,
      status: 'succeeded',
      ranAt: now,
    });
    await repo.upsertRun({
      ciInstallationId: inst1.id,
      workflowRunId: `wf-filter-old-failed-${Date.now()}`,
      status: 'failed',
      ranAt: oldDate,
    });
    await repo.upsertRun({
      ciInstallationId: inst2.id,
      workflowRunId: `wf-filter-recent-running-${Date.now()}`,
      status: 'running',
      ranAt: now,
    });

    const all = await repo.listRuns(workspaceA, {});
    const relevant = all.items.filter((i) => [inst1.id, inst2.id].includes(i.ci_installation_id ?? ''));
    expect(relevant.length).toBeGreaterThanOrEqual(3);

    const byRepo = await repo.listRuns(workspaceA, { repo: repo1 });
    expect(byRepo.items.every((i) => i.ci_installation_id === inst1.id)).toBe(true);
    expect(byRepo.items.some((i) => i.ci_installation_id === inst2.id)).toBe(false);

    const byAgent = await repo.listRuns(workspaceA, { agent_id: agentId2 });
    expect(byAgent.items.every((i) => i.ci_installation_id === inst2.id)).toBe(true);

    const byStatus = await repo.listRuns(workspaceA, { status: 'failed' });
    expect(byStatus.items.every((i) => i.status === 'failed')).toBe(true);
    expect(byStatus.items.some((i) => i.ci_installation_id === inst1.id)).toBe(true);

    const byWindow = await repo.listRuns(workspaceA, { window: '7d', repo: repo1 });
    expect(byWindow.items.some((i) => i.status === 'failed')).toBe(false);
    expect(byWindow.items.some((i) => i.status === 'succeeded')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Small raw-condition helpers kept local to this test file (assertions read
// back the underlying rows directly, independent of the repository's own
// mapping, to prove the SQL actually did what the repository claims).
// ---------------------------------------------------------------------------
function sqlEqAgentRepo(agentId: string, repoName: string) {
  return and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repoName));
}

function sqlEqWorkflowRunId(workflowRunId: string) {
  return eq(t.ciRuns.workflowRunId, workflowRunId);
}

function sqlEqId(id: string) {
  return eq(t.ciInstallations.id, id);
}
