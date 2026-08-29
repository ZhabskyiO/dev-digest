/**
 * T17 — Export-to-CI end-to-end, DB-backed (real Postgres via
 * `test/helpers/pg.ts`, hence `.it.test.ts` per `server/CLAUDE.md`'s
 * unit/integration split).
 *
 * Walks the full HTTP surface through `app.inject`: preview → export →
 * re-export → ingest → list — with `MockGitHubClient`/`MockCiRunnerBundle`
 * injected via `ContainerOverrides` and a REAL `CiRepository`/`CiIngestService`
 * hitting the testcontainers DB (both construct their own repository from
 * `container.db` when none is injected — see server/insights/INSIGHTS.md
 * 2026-08-27's `CiRepositoryLike` entry — so routing through the real HTTP
 * layer with `overrides.db` set is the only way to prove the persisted rows,
 * not a hermetic `app.inject()` with no DB).
 *
 * `MockGitHubClient`'s `opts` object is captured by reference at construction
 * and read fresh on every call — mutating fields on that SAME object after
 * `buildApp()` (to add ingest's `workflowRuns`/`artifactFiles` fixtures once
 * an installation exists) is a legitimate way to update its fixtures later
 * without touching `adapters/mocks.ts` (out of this task's owned paths).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { CiExport, CiPreview, CiRunList } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import {
  MockAuthProvider,
  MockGitHubClient,
  MockCiRunnerBundle,
  type MockGitHubOptions,
} from '../../adapters/mocks.js';
import { CiIngestService } from './ingest.js';
import * as t from '../../db/schema.js';
import type { Db } from '../../db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-routes] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function insertWorkspace(db: Db, name: string): Promise<string> {
  const [row] = await db.insert(t.workspaces).values({ name }).returning({ id: t.workspaces.id });
  return row!.id;
}

async function insertAgent(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: 'CI Walk Agent',
      provider: 'openai',
      model: 'gpt-test',
      systemPrompt: 'Review this PR.',
    })
    .returning({ id: t.agents.id });
  return row!.id;
}

const REPO = 'acme/ci-walk-repo';

d('CI routes (preview → export → re-export → ingest → list, testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let githubOpts: MockGitHubOptions;
  let github: MockGitHubClient;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    workspaceId = await insertWorkspace(pg.handle.db, 'ci-routes-it-ws');
    agentId = await insertAgent(pg.handle.db, workspaceId);

    githubOpts = {};
    github = new MockGitHubClient(githubOpts);

    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        auth: new MockAuthProvider(
          { id: 'u1', email: 'you@local', name: 'You' },
          { id: workspaceId, name: 'ci-routes-it-ws' },
        ),
        github,
        ciRunnerBundle: new MockCiRunnerBundle(),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  beforeEach(() => {
    // Module-scoped throttle (server/insights/INSIGHTS.md, 2026-08-27) — never
    // let an earlier suite's cache entry silently make `/ci-runs/refresh`
    // a no-op here.
    CiIngestService.resetThrottleForTests();
  });

  it('walks preview → export → re-export → ingest → list, asserting the persisted rows at each step', async () => {
    // -----------------------------------------------------------------
    // Step 1 — preview: zero side effects (AC-13). No installation row,
    // no GitHub call.
    // -----------------------------------------------------------------
    const previewRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/ci-preview`,
      payload: { repo: REPO, target: 'gha' },
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as CiPreview;
    expect(preview.files.length).toBeGreaterThan(0);
    expect(preview.repo).toBe(REPO);

    const rowsAfterPreview = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, REPO));
    expect(rowsAfterPreview).toHaveLength(0);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);

    // -----------------------------------------------------------------
    // Step 2 — export: commits the bundle, opens a PR, persists exactly
    // ONE installation row (AC-26, AC-28, AC-29).
    // -----------------------------------------------------------------
    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: REPO, target: 'gha' },
    });
    expect(exportRes.statusCode).toBe(200);
    const exported = exportRes.json() as CiExport;
    expect(exported.pr_url).not.toBeNull();
    expect(exported.installation.repo).toBe(REPO);
    expect(exported.installation.agent_id).toBe(agentId);

    const rowsAfterExport = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, REPO));
    expect(rowsAfterExport).toHaveLength(1);
    expect(rowsAfterExport[0]!.agentId).toBe(agentId);
    const installationId = rowsAfterExport[0]!.id;
    expect(github.committed).toHaveLength(1);
    expect(github.openedPrs).toHaveLength(1);

    // -----------------------------------------------------------------
    // Step 3 — re-export: an update, not a second row, and the SAME PR
    // is reused (AC-27, AC-29, AC-49/AC-50).
    // -----------------------------------------------------------------
    const reExportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { repo: REPO, target: 'gha' },
    });
    expect(reExportRes.statusCode).toBe(200);
    const reExported = reExportRes.json() as CiExport;
    expect(reExported.installation.id).toBe(installationId);
    expect(reExported.pr_url).toBe(exported.pr_url);

    const rowsAfterReExport = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, REPO));
    expect(rowsAfterReExport).toHaveLength(1);
    expect(rowsAfterReExport[0]!.id).toBe(installationId);
    expect(github.committed).toHaveLength(2); // committed again ...
    expect(github.openedPrs).toHaveLength(1); // ... but no second PR opened

    // -----------------------------------------------------------------
    // Step 4 — ingest: GitHub reports one completed workflow run with a
    // valid result artifact; `POST /ci-runs/refresh` must persist it
    // (AC-40, AC-42) keyed on `workflow_run_id`, linked to the real
    // installation row above.
    // -----------------------------------------------------------------
    const workflowRunId = 'run-walk-1';
    githubOpts.workflowRuns = [
      {
        id: workflowRunId,
        status: 'completed',
        conclusion: 'success',
        html_url: `https://github.com/${REPO}/actions/runs/1`,
        pr_number: 7,
        created_at: '2026-01-01T00:00:00Z',
        run_started_at: '2026-01-01T00:00:05Z',
        updated_at: '2026-01-01T00:05:00Z',
      },
    ];
    githubOpts.artifactFiles = {
      [`${workflowRunId}/devdigest-result/devdigest-result.json`]: JSON.stringify({
        findings_count: 2,
        critical: 1,
        warning: 1,
        suggestion: 0,
        cost_usd: 0.013,
        duration_ms: 12000,
        agent: 'CI Walk Agent',
        version: '1',
        pr_number: 7,
      }),
    };

    const refreshRes = await app.inject({ method: 'POST', url: '/ci-runs/refresh', payload: {} });
    expect(refreshRes.statusCode).toBe(200);
    const refreshed = refreshRes.json() as CiRunList;
    expect(refreshed.refresh_error).toBeNull();

    // `CiRunListItem.id` is the persisted row's UUID, NOT `workflow_run_id`
    // (`repository.ts::toCiRun` maps `row.id` — the GitHub-side run id is
    // stored separately as `ci_runs.workflow_run_id`) — read the row back by
    // that column to get the id the API response is keyed on.
    const runRows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.workflowRunId, workflowRunId));
    expect(runRows).toHaveLength(1);
    expect(runRows[0]!.ciInstallationId).toBe(installationId);
    expect(runRows[0]!.status).toBe('succeeded');
    expect(runRows[0]!.findingsCount).toBe(2);
    expect(runRows[0]!.costUsd).toBeCloseTo(0.013);
    const runId = runRows[0]!.id;

    const refreshedRun = refreshed.items.find((i) => i.id === runId);
    expect(refreshedRun).toBeDefined();
    expect(refreshedRun?.status).toBe('succeeded');
    expect(refreshedRun?.findings_count).toBe(2);

    // -----------------------------------------------------------------
    // Step 5 — list: a plain read reflects the ingested run without
    // touching GitHub again (AC-46).
    // -----------------------------------------------------------------
    const callsBeforeList = github.listWorkflowRunsCalls.length;
    const listRes = await app.inject({ method: 'GET', url: `/ci-runs?repo=${encodeURIComponent(REPO)}` });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json() as CiRunList;
    const listedRun = listed.items.find((i) => i.id === runId);
    expect(listedRun).toBeDefined();
    expect(listedRun?.status).toBe('succeeded');
    expect(github.listWorkflowRunsCalls).toHaveLength(callsBeforeList);
  });
});
