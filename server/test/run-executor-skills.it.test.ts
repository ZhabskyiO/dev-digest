import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
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

/** A minimal unified diff — content of the review outcome isn't the point here. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/**
 * L02 — skills feed into the review. Covers the run-executor's "Loading
 * skills" step end to end: an enabled, agent-linked skill's body must reach
 * the persisted trace's `prompt_assembly.skills`, and its id must land in
 * `run_skills` for that run.
 */
d('run-executor: skills feed into the review (Testcontainers pg)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  async function setupRepoAndPr() {
    const name = `skills-feed-${Date.now()}`;
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
    return pr!;
  }

  it('an enabled, linked skill lands in the trace prompt_assembly and in run_skills', async () => {
    const app = await makeApp();
    const pr = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skills Feed Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const skillBody = '# Conventional Commits\n\nUse `type(scope): subject`.';
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Conventional Commits',
          description: 'Commit message rules.',
          type: 'convention',
          body: skillBody,
        },
      })
    ).json();

    const attach = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    expect(attach.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).not.toBeNull();
    expect(trace.prompt_assembly.skills).toContain(skillBody);

    const rows = await pg.handle.db
      .select()
      .from(t.runSkills)
      .where(and(eq(t.runSkills.runId, runId), eq(t.runSkills.skillId, skill.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.order).toBe(0);

    await app.close();
  });

  it('a disabled skill stays linked but is excluded — no trace skills, no run_skills row', async () => {
    const app = await makeApp();
    const pr = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Disabled Skill Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Disabled Rule',
          description: 'Should not be attached.',
          type: 'convention',
          body: '# Disabled\n\nShould never appear in a prompt.',
        },
      })
    ).json();
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toBeNull();

    const rows = await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, runId));
    expect(rows).toHaveLength(0);

    await app.close();
  });
});
