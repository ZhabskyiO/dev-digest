import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { RUN_TRIGGER_RATE_LIMIT } from '../src/modules/_shared/rate-limits.js';
import * as t from '../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import type { ReviewService } from '../src/modules/reviews/service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[multi-agent] Docker not available — skipping integration tests.');
}

// Intent derivation and the post-loop brief hook would otherwise spend their
// own `completeStructured` call through the same shared `openai` provider
// override — INTENT_ENABLED=false skips the former, and omitting `pr_files`
// rows (see setupRepoAndPr) makes the brief hook's `selectFilesToSummarize`
// return `[]` so it skips its call too. Neither changes anything this suite
// asserts (server/insights/gotchas.md 2026-08-27 precedent).
const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test', INTENT_ENABLED: 'false' } as NodeJS.ProcessEnv);

/** A unified diff touching src/config.ts (only new-side line 11 exists). */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** Returned by the agent whose `model` is `flag-model` — flags line 11. */
const FLAG_REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Found a hardcoded secret.',
  score: 60,
  findings: [
    {
      id: 'f-flag',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live-looking secret literal is committed.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** Returned by every other agent — a clean, finding-free review. */
const CLEAN_REVIEW: Review = {
  verdict: 'approve',
  summary: 'Nothing to flag.',
  score: 95,
  findings: [],
};

/**
 * Dispatches a fixture per `req.model` so two agents sharing ONE provider
 * (and therefore one `container.llm()` instance) can behave independently
 * within a single multi-agent run. An optional real `setTimeout` sleep (never
 * `vi.useFakeTimers()` — fake timers don't let concurrent jobs race
 * realistically, server/insights/gotchas.md 2026-08-21) lets a test observe
 * the response returning BEFORE the background run completes (AC-24).
 */
class DispatchLLM extends MockLLMProvider {
  constructor(private sleepMs = 20) {
    super('openai', {});
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (this.sleepMs > 0) await new Promise((r) => setTimeout(r, this.sleepMs));
    this.calls.push({ method: 'completeStructured', req });
    const fixture = req.model === 'flag-model' ? FLAG_REVIEW : CLEAN_REVIEW;
    return {
      data: fixture as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }
}

/**
 * T10 — the multi-agent module's application + transport layers (AC-17,
 * AC-18, AC-19, AC-20, AC-21, AC-23, AC-24, AC-31).
 *
 * Each test uses its own repo/PR/agents so tests can run against the same
 * shared Postgres fixture without interfering with each other. No `pr_files`
 * rows are inserted anywhere in this file — `MockGitClient`'s injected diff
 * is what grounding runs against, and the absence of `pr_files` is what
 * keeps the PR Brief hook from spending its own model call (see the
 * `config()` comment above).
 */
d('multi-agent module — service + routes (T10)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-workspace-multi-agent-${Date.now()}` })
      .returning();
    otherWorkspaceId = otherWs!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  async function setupRepoAndPr(wsId: string) {
    const n = repoSeq++;
    const name = `multi-agent-${n}-${Date.now()}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId: repo!.id,
        number: 900 + n,
        title: 'Multi-agent PR',
        author: 'marisa.koch',
        branch: 'feat/multi-agent',
        base: 'main',
        headSha: `sha-${n}`,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  async function makeAgent(wsId: string, name: string, model: string) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: wsId, name, provider: 'openai', model, systemPrompt: 'review' })
      .returning();
    return row!;
  }

  it(
    'AC-17/AC-24: creates one multi_agent_runs row linking every spawned agent_runs row, ' +
      'and returns one run id per agent before any review completes',
    async () => {
      // 2000ms, not 300ms: the assertion right below races the two post-inject
      // DB selects against the LLM stub's sleep, and a 300ms window is thin
      // enough to flake on a loaded runner (Finding 5, pr-self-review). 2s
      // comfortably outlasts `app.inject()` + two `db.select()` round trips
      // while staying well under `waitForPrRuns`'s 10s default timeout below.
      const llm = new DispatchLLM(2000);
      const app = await appWith(llm);
      const { pr } = await setupRepoAndPr(workspaceId);
      const agentA = await makeAgent(workspaceId, 'Agent A', 'flag-model');
      const agentB = await makeAgent(workspaceId, 'Agent B', 'clean-model');

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agentA.id, agentB.id] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pr_id).toBe(pr.id);
      expect(body.runs).toHaveLength(2);
      const runIds: string[] = body.runs.map((r: { run_id: string }) => r.run_id);
      expect(new Set(body.runs.map((r: { agent_id: string }) => r.agent_id))).toEqual(
        new Set([agentA.id, agentB.id]),
      );

      // AC-24: the response is back BEFORE any spawned review has completed —
      // the DispatchLLM sleeps 300ms per call, so right after `inject`
      // resolves every spawned run must still be 'running'.
      const inFlight = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(inArray(t.agentRuns.id, runIds));
      expect(inFlight).toHaveLength(2);
      expect(inFlight.every((r) => r.status === 'running')).toBe(true);

      // AC-17: exactly one multi_agent_runs row, and every spawned run links
      // back to it via multi_run_id.
      const multiRuns = await pg.handle.db
        .select()
        .from(t.multiAgentRuns)
        .where(eq(t.multiAgentRuns.id, body.multi_run_id));
      expect(multiRuns).toHaveLength(1);
      expect(inFlight.every((r) => r.multiRunId === body.multi_run_id)).toBe(true);

      await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
      await app.close();
    },
  );

  it('AC-18: GET /pulls/:id/multi-agent returns columns + conflicts + totals in one response', async () => {
    const llm = new DispatchLLM(20);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    const agentA = await makeAgent(workspaceId, 'Agent A2', 'flag-model');
    const agentB = await makeAgent(workspaceId, 'Agent B2', 'clean-model');

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA.id, agentB.id] },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.pr_id).toBe(pr.id);
    expect(body.status).toBe('complete');
    expect(body.columns).toHaveLength(2);
    expect(body.total_duration_ms).not.toBeNull();
    expect(body.total_cost_usd).toBeCloseTo(0.002, 5);

    // one location group: agent A flagged src/config.ts:11, agent B did not.
    expect(body.conflicts.length).toBeGreaterThan(0);
    const conflict = body.conflicts.find((c: { file: string }) => c.file === 'src/config.ts');
    expect(conflict).toBeDefined();
    const verdictByAgent: Record<string, string> = Object.fromEntries(
      conflict.takes.map((take: { agent_id: string; verdict: string }) => [
        take.agent_id,
        take.verdict,
      ]),
    );
    expect(verdictByAgent[agentA.id]).toBe('CRITICAL');
    expect(verdictByAgent[agentB.id]).toBe('ignored');

    await app.close();
  });

  it('AC-19: a PR with no multi-agent run yet returns 200 with a null body, not 404', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: CLEAN_REVIEW }));
    const { pr } = await setupRepoAndPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('AC-20: a PR from another workspace, and an agent from another workspace, both 404 with no row data', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: CLEAN_REVIEW }));
    const { pr: foreignPr } = await setupRepoAndPr(otherWorkspaceId);
    const { pr: ownPr } = await setupRepoAndPr(workspaceId);
    const ownAgent = await makeAgent(workspaceId, 'Own Agent', 'clean-model');
    const foreignAgent = await makeAgent(otherWorkspaceId, 'Foreign Agent', 'clean-model');

    const getForeignPr = await app.inject({
      method: 'GET',
      url: `/pulls/${foreignPr.id}/multi-agent`,
    });
    expect(getForeignPr.statusCode).toBe(404);
    expect(getForeignPr.json()).not.toHaveProperty('columns');

    const startForeignPr = await app.inject({
      method: 'POST',
      url: `/pulls/${foreignPr.id}/multi-agent-run`,
      payload: { agent_ids: [ownAgent.id] },
    });
    expect(startForeignPr.statusCode).toBe(404);
    expect(startForeignPr.json()).not.toHaveProperty('runs');

    const startForeignAgent = await app.inject({
      method: 'POST',
      url: `/pulls/${ownPr.id}/multi-agent-run`,
      payload: { agent_ids: [foreignAgent.id] },
    });
    expect(startForeignAgent.statusCode).toBe(404);
    expect(startForeignAgent.json()).not.toHaveProperty('runs');

    await app.close();
  });

  it('AC-21: empty, duplicate, and foreign agent_ids all 4xx and leave persisted counts unchanged', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: CLEAN_REVIEW }));
    const { pr } = await setupRepoAndPr(workspaceId);
    const ownAgent = await makeAgent(workspaceId, 'Own Agent 2', 'clean-model');
    const foreignAgent = await makeAgent(otherWorkspaceId, 'Foreign Agent 2', 'clean-model');

    async function counts() {
      const multi = await pg.handle.db
        .select()
        .from(t.multiAgentRuns)
        .where(eq(t.multiAgentRuns.prId, pr.id));
      const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
      return { multi: multi.length, runs: runs.length };
    }

    const before = await counts();

    const empty = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [] },
    });
    expect(empty.statusCode).toBeGreaterThanOrEqual(400);
    expect(empty.statusCode).toBeLessThan(500);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [ownAgent.id, ownAgent.id] },
    });
    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);
    expect(duplicate.statusCode).toBeLessThan(500);

    const foreign = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [foreignAgent.id] },
    });
    expect(foreign.statusCode).toBeGreaterThanOrEqual(400);
    expect(foreign.statusCode).toBeLessThan(500);

    expect(await counts()).toEqual(before);

    await app.close();
  });

  it(
    'Finding 1 (pr-self-review): a start whose runReview throws leaves multi_agent_runs count unchanged',
    async () => {
      // `container.reviews` is overridden with a stub that always throws —
      // standing in for `runReview` failing after `start()` already created
      // the `multi_agent_runs` row (e.g. the repo was deleted between the
      // checks and this call, or a DB failure mid its `createAgentRun` loop).
      const throwingReviews = {
        runReview: async () => {
          throw new Error('simulated late failure');
        },
      } as unknown as ReviewService;

      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: DIFF }),
          llm: { openai: new MockLLMProvider('openai', { structured: CLEAN_REVIEW }) },
          reviews: throwingReviews,
        },
      });
      const { pr } = await setupRepoAndPr(workspaceId);
      const agent = await makeAgent(workspaceId, 'Agent Throw', 'clean-model');

      const before = await pg.handle.db
        .select()
        .from(t.multiAgentRuns)
        .where(eq(t.multiAgentRuns.prId, pr.id));
      expect(before).toHaveLength(0);

      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agent.id] },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);

      const after = await pg.handle.db
        .select()
        .from(t.multiAgentRuns)
        .where(eq(t.multiAgentRuns.prId, pr.id));
      expect(after).toHaveLength(0);

      await app.close();
    },
  );

  it('AC-31: a grouped read (GET /pulls/:id/multi-agent) makes zero completeStructured calls', async () => {
    const llm = new DispatchLLM(20);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(workspaceId);
    const agentA = await makeAgent(workspaceId, 'Agent A3', 'flag-model');
    const agentB = await makeAgent(workspaceId, 'Agent B3', 'clean-model');

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA.id, agentB.id] },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const callsBefore = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsBefore).toBeGreaterThan(0);

    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });

    const callsAfter = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsAfter).toBe(callsBefore);

    await app.close();
  });
});

// No Docker/Postgres needed — a plain source-level check, so it always runs
// (never gated behind `d`).
describe('AC-23: the multi-agent trigger shares the single-review trigger\'s rate limit', () => {
  it('RUN_TRIGGER_RATE_LIMIT is 10/min, and both trigger routes reference the constant', async () => {
    expect(RUN_TRIGGER_RATE_LIMIT).toEqual({ max: 10, timeWindow: '1 minute' });

    const multiAgentRoutesSrc = await readFile(
      new URL('../src/modules/multi-agent/routes.ts', import.meta.url),
      'utf8',
    );
    const reviewsRoutesSrc = await readFile(
      new URL('../src/modules/reviews/routes.ts', import.meta.url),
      'utf8',
    );
    expect((multiAgentRoutesSrc.match(/RUN_TRIGGER_RATE_LIMIT/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((reviewsRoutesSrc.match(/RUN_TRIGGER_RATE_LIMIT/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
