import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const APPROVE: Review = { verdict: 'approve', summary: 'Looks fine.', score: 90, findings: [] };
const REQUEST_CHANGES: Review = {
  verdict: 'request_changes',
  summary: 'One critical issue.',
  score: 40,
  findings: [],
};

/**
 * GET /agents/:id/stats — the AgentCard summary row + editor Stats tab tiles.
 * MockLLMProvider always returns costUsd: 0.001 for a completed run
 * (adapters/mocks.ts), so a run through it gives a real, non-null cost/
 * duration to aggregate — this exercises the actual DB aggregation, not just
 * the zero-runs default.
 */
d('GET /agents/:id/stats', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(review: Review) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: review }) },
      },
    });
  }

  async function setupRepoAndPr(app: Awaited<ReturnType<typeof buildApp>>) {
    const name = `agent-stats-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    void app;
    return pr!;
  }

  async function runOnce(agentId: string, review: Review) {
    const app = await makeApp(review);
    const pr = await setupRepoAndPr(app);
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await app.close();
  }

  it('a brand-new agent with zero runs returns runs: 0 and every average as null', async () => {
    const app = await makeApp(APPROVE);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Fresh Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runs: 0,
      accept_rate: null,
      avg_cost_usd: null,
      avg_cost_usd_delta: null,
      avg_duration_ms: null,
      trend: [],
    });
    await app.close();
  });

  it('aggregates runs, cost, duration, and accept rate across two completed runs', async () => {
    const bootstrap = await makeApp(APPROVE);
    const agent = (
      await bootstrap.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Two Run Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await bootstrap.close();

    // One approved run, one request_changes run — accept_rate must land at 50.
    await runOnce(agent.id, APPROVE);
    await runOnce(agent.id, REQUEST_CHANGES);

    const app = await makeApp(APPROVE);
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.runs).toBe(2);
    expect(stats.accept_rate).toBe(50);
    expect(stats.avg_cost_usd).toBeCloseTo(0.001, 6);
    expect(stats.avg_duration_ms).toBeGreaterThanOrEqual(0);
    await app.close();
  });

  it('with ?days= populates a same-length daily trend and leaves the delta null with no prior window', async () => {
    const bootstrap = await makeApp(APPROVE);
    const agent = (
      await bootstrap.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Trend Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await bootstrap.close();

    await runOnce(agent.id, APPROVE);
    await runOnce(agent.id, APPROVE);

    const app = await makeApp(APPROVE);
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?days=7` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.trend).toHaveLength(7);
    // Both runs happened "now" (test executes in seconds), so today's bucket
    // (the last element, oldest-first) must carry both of them.
    expect(stats.trend[6]).toBe(2);
    expect(stats.trend.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    // No runs exist in the preceding 7-day window, so the delta has nothing
    // to compare against and must be null, not a misleading 0.
    expect(stats.avg_cost_usd_delta).toBeNull();
    await app.close();
  });

  it('clamps an absurd ?days= so the trend array and delta window stay bounded', async () => {
    const app = await makeApp(APPROVE);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Clamped Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?days=100000` });
    expect(res.statusCode).toBe(200);
    // MAX_TREND_DAYS caps the trend length even though `days` itself is echoed nowhere else.
    expect(res.json().trend.length).toBeLessThanOrEqual(90);
    await app.close();
  });

  it('404s for an unknown agent', async () => {
    const app = await makeApp(APPROVE);
    const ghost = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({ method: 'GET', url: `/agents/${ghost}/stats` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
