import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Intent, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
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

/** What the (cheap) intent model returns for the PR built by setupRepoAndPr. */
const INTENT_FIXTURE: Intent = {
  intent: 'Add rate limiting to the payments API.',
  in_scope: ['src/config.ts'],
  out_of_scope: ['billing reconciliation'],
  risk_areas: [{ kind: 'security', label: 'Secret handling' }],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  // ==========================================================================
  // POST /pulls/:id/intent/recalculate — the ONE manual, token-spending trigger
  //
  // The route's per-route rate limit is NOT exercised here: app.ts skips
  // registering @fastify/rate-limit entirely when nodeEnv === 'test', so
  // `config.rateLimit` is inert under inject(). What IS testable — and is the
  // fence that actually matters — is the per-PR in-flight dedupe.
  // ==========================================================================

  /** `review_intent` resolves to provider `openai` by default (FEATURE_MODELS). */
  function intentApp(llm: MockLLMProvider, cfg = config()) {
    return buildApp({
      config: cfg,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  /** Structured calls the mock served for the `Intent` schema (not `Review`). */
  const intentCalls = (llm: MockLLMProvider) =>
    llm.calls.filter(
      (c) =>
        c.method === 'completeStructured' &&
        (c.req as { schemaName?: string }).schemaName === 'Intent',
    );

  const intentLlm = () =>
    new MockLLMProvider('openai', {
      structuredBySchema: { Intent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });

  it('recalculate: 404 for an unknown PR and for a PR in another workspace', async () => {
    const llm = intentLlm();
    const app = await intentApp(llm);

    const unknown = await app.inject({
      method: 'POST',
      url: `/pulls/${randomUUID()}/intent/recalculate`,
    });
    expect(unknown.statusCode).toBe(404);

    // The ownership check: `pr_intent` carries no workspace_id, so a PR that
    // exists but belongs to someone else must 404, not derive.
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-ws' })
      .returning();
    const { pr: foreignPr } = await setupRepoAndPr(pg.handle.db, other!.id);
    const foreign = await app.inject({
      method: 'POST',
      url: `/pulls/${foreignPr.id}/intent/recalculate`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(intentCalls(llm)).toHaveLength(0);

    await app.close();
  });

  it('recalculate: derives on a PR that was never reviewed and returns full provenance', async () => {
    const llm = intentLlm();
    const app = await intentApp(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // No run has ever touched this PR, so the GET is the empty state.
    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(before.json()).toBeNull();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/intent/recalculate`,
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.intent).toBe(INTENT_FIXTURE.intent);
    expect(detail.pr_id).toBe(pr.id);
    expect(detail.head_sha).toBe(pr.headSha);
    // Confidence is computed server-side from the evidence, never model-reported.
    expect(detail.confidence.sources).toEqual(
      expect.arrayContaining(['title', 'branch', 'commits', 'paths']),
    );
    expect(detail.provider).toBe('openai');
    expect(detail.model).toBe('gpt-4.1-mini');
    expect(intentCalls(llm)).toHaveLength(1);

    // and it is readable through the ordinary GET afterwards
    const after = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(after.json().derived_at).toBe(detail.derived_at);

    await app.close();
  });

  it('recalculate: bypasses the head_sha cache — the same head re-derives', async () => {
    const llm = intentLlm();
    const app = await intentApp(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const first = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recalculate` })
    ).json();
    await new Promise((r) => setTimeout(r, 5)); // so derived_at can strictly advance
    const second = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recalculate` })
    ).json();

    // This is the whole point of the endpoint: `deriveForRun` would have
    // returned the cached row here (same head_sha) without calling the model.
    expect(intentCalls(llm)).toHaveLength(2);
    expect(second.head_sha).toBe(first.head_sha);
    expect(new Date(second.derived_at).getTime()).toBeGreaterThan(
      new Date(first.derived_at).getTime(),
    );

    await app.close();
  });

  it('recalculate: concurrent calls for one PR share a single derivation', async () => {
    // Delayed structured output widens the window the in-flight entry is held,
    // so the second request reliably arrives while the first is still deriving.
    class SlowLLM extends MockLLMProvider {
      override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        await new Promise((r) => setTimeout(r, 60));
        return super.completeStructured(req);
      }
    }
    const llm = new SlowLLM('openai', {
      structuredBySchema: { Intent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
    });
    const app = await intentApp(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recalculate` }),
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recalculate` }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().derived_at).toBe(b.json().derived_at);
    // ONE model call for two clicks — the fence the rate limit can't provide.
    expect(intentCalls(llm)).toHaveLength(1);

    // The entry is cleared afterwards, so a later call derives again.
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recalculate` });
    expect(intentCalls(llm)).toHaveLength(2);

    await app.close();
  });

  it('recalculate: a failed derivation is a 502 and leaves the stored intent intact', async () => {
    const good = intentLlm();
    const app = await intentApp(good);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const stored = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/recalculate` })
    ).json();
    await app.close();

    // No `Intent` fixture ⇒ the mock's schema parse throws, standing in for any
    // derivation failure (missing key, bad structured output, timeout).
    const broken = new MockLLMProvider('openai', {
      structuredBySchema: { Review: REVIEW_FIXTURE },
    });
    const app2 = await intentApp(broken);
    const res = await app2.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/intent/recalculate`,
    });
    // Reported, not swallowed: D5 protects a *run*, and there is no run here.
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('external_service_error');

    const still = (await app2.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` })).json();
    expect(still.derived_at).toBe(stored.derived_at);

    await app2.close();
  });

  it('recalculate: 422 with no model call when INTENT_ENABLED=false', async () => {
    const llm = intentLlm();
    const app = await intentApp(
      llm,
      loadConfig({ ...process.env, NODE_ENV: 'test', INTENT_ENABLED: 'false' } as NodeJS.ProcessEnv),
    );
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/intent/recalculate`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    expect(intentCalls(llm)).toHaveLength(0);

    await app.close();
  });
});
