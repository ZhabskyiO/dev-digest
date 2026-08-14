import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

/**
 * POST /reviews/local — the pre-push path (`devdigest review --mode working`).
 *
 * The point of these tests is that the LOCAL path is the same review as the PR
 * path, not a parallel one: the same agent row, the same engine, and above all
 * the same citation-grounding gate, which must drop a finding that cites a line
 * the diff does not contain. Nothing may be persisted — there is no PR to hang
 * a review off.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A working-tree diff as `git diff HEAD` emits it: one edit, one new file. */
const WORKING_DIFF = `diff --git a/src/config.ts b/src/config.ts
index ce01362..9a7a4b5 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3e75765
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const answer = 42;
`;

/** One grounded finding (line 11 is in the diff) and one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

d('local review (POST /reviews/local)', () => {
  let pg: PgFixture;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const app = await appWith(REVIEW_FIXTURE);
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Local Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    agentId = created.json().id;
    await app.close();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  it('reviews a working-tree diff and returns grounded findings + the gate verdict', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/local',
      payload: { mode: 'working', diff: WORKING_DIFF, agentId, label: 'demo @ abc1234' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.mode).toBe('working');
    expect(body.agent.id).toBe(agentId);
    expect(body.files).toBe(2);

    // Grounding is the SAME gate as a PR review: the line-999 finding is dropped.
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].file).toBe('src/config.ts');
    expect(body.findings[0].start_line).toBe(11);
    expect(body.grounding).toBe('1/2 passed');

    // Blocking is deterministic from severity + gate, not from the model's verdict.
    expect(body.counts).toEqual({ critical: 1, warning: 0, suggestion: 0 });
    expect(body.fail_on).toBe('critical');
    expect(body.blockers).toBe(1);
    expect(body.blocking).toBe(true);

    // No repo was named, so the prompt ran without repo-intel context — and says so.
    expect(body.degraded.join(' ')).toContain('no repo given');

    await app.close();
  });

  it('persists nothing — a local review leaves no review, finding, or run row', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const before = await counts();

    const res = await app.inject({
      method: 'POST',
      url: '/reviews/local',
      payload: { mode: 'working', diff: WORKING_DIFF, agentId },
    });
    expect(res.statusCode).toBe(200);

    expect(await counts()).toEqual(before);
    await app.close();
  });

  it('honours a failOn override — same findings, different gate', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/local',
      payload: { mode: 'working', diff: WORKING_DIFF, agentId, failOn: 'never' },
    });

    const body = res.json();
    expect(body.findings).toHaveLength(1);
    expect(body.fail_on).toBe('never');
    expect(body.blockers).toBe(0);
    expect(body.blocking).toBe(false);
    await app.close();
  });

  it('rejects a mode the server does not implement yet', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/local',
      payload: { mode: 'staged', diff: WORKING_DIFF, agentId },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('not implemented yet');
    await app.close();
  });

  it('rejects a diff with nothing reviewable in it', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/local',
      payload: { mode: 'working', diff: 'not a diff at all\n', agentId },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('no reviewable file changes');
    await app.close();
  });

  it('404s on an unknown agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/local',
      payload: {
        mode: 'working',
        diff: WORKING_DIFF,
        agentId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  /** Row counts of everything a PR review would have written. */
  async function counts() {
    const [reviews, findings, runs] = await Promise.all([
      pg.handle.db.select().from(t.reviews),
      pg.handle.db.select().from(t.findings),
      pg.handle.db.select().from(t.agentRuns),
    ]);
    return { reviews: reviews.length, findings: findings.length, runs: runs.length };
  }
});
