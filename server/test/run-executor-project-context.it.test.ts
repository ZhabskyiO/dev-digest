import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * T17 — run-executor wiring for project context. Covers the "Loading project
 * context" step end to end: an agent's effective attachment set must reach
 * the prompt's `## Project context` slot (AC-20), and the persisted trace
 * must record BOTH an injected and a since-deleted attachment with distinct
 * outcomes, while `specs_read` lists only the one actually injected (AC-29,
 * AC-30). See specs/2026-08-18-project-context.md.
 */
d('run-executor: project context feeds into the review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    clonePath = await mkdtemp(join(tmpdir(), 'dd-project-context-'));
    await mkdir(join(clonePath, 'specs'), { recursive: true });
    await writeFile(
      join(clonePath, 'specs', 'security-baseline.md'),
      '# Security baseline\n\nNever log secrets.',
    );
    await writeFile(
      join(clonePath, 'specs', 'public-api.md'),
      '# Public API\n\nAll routes are versioned.',
    );
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

  async function setupRepoAndPr(app: Awaited<ReturnType<typeof makeApp>>) {
    const name = `project-context-feed-${Date.now()}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
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

    // Discover the two fixture documents and stamp them into
    // project_context_documents so they can be attached below.
    const rescan = await app.inject({
      method: 'POST',
      url: `/repos/${repo!.id}/context/rescan`,
    });
    expect(rescan.statusCode).toBe(200);

    return { repo: repo!, pr: pr! };
  }

  it('one injected, one deleted attachment: distinct trace outcomes, specs_read lists only the injected one', async () => {
    const app = await makeApp();
    const { repo, pr } = await setupRepoAndPr(app);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Project Context Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const attach = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: {
        documents: [
          { repo_id: repo.id, path: 'specs/security-baseline.md' },
          { repo_id: repo.id, path: 'specs/public-api.md' },
        ],
      },
    });
    expect(attach.statusCode).toBe(200);

    // Delete one attached document from the clone AFTER attaching, so the
    // run resolves it as `missing` (deleted between attach and run) while
    // the other stays injected.
    await rm(join(clonePath, 'specs', 'public-api.md'));

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // AC-30 — "Specs read" lists only the document actually injected.
    expect(trace.specs_read).toEqual(['specs/security-baseline.md']);

    // AC-29 — every document in the effective set has a distinct outcome.
    expect(trace.project_context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'specs/security-baseline.md', outcome: 'injected' }),
        expect.objectContaining({ path: 'specs/public-api.md', outcome: 'missing' }),
      ]),
    );
    expect(trace.project_context).toHaveLength(2);

    // AC-20/AC-21 — the assembled user message carries the injected
    // document, wrapped as untrusted, directly under the `## Project
    // context` slot.
    expect(trace.prompt_assembly.user).toMatch(/## Project context\s*\n<untrusted source="spec-0">/);
    expect(trace.prompt_assembly.user).toContain('Never log secrets.');
    // The deleted document never reaches the prompt.
    expect(trace.prompt_assembly.user).not.toContain('All routes are versioned.');

    await app.close();
  });
});
