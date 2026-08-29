import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { AgentRow } from '../src/db/rows.js';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

// Intent derivation and the post-loop "summarize changed files" brief hook
// each spend their own `completeStructured` call through the SAME shared
// `openai` provider override — sharing the per-agent DispatchLLM would add
// their sleep on top of the measured loop, defeating the timing assertion
// below. INTENT_ENABLED=false skips the former; omitting `pr_files` rows
// (see setupRepoAndPr) makes `selectFilesToSummarize` return `[]` so the
// brief hook skips its model call too (`brief/service.ts`'s
// `generateFileSummaries`) — neither changes what this test actually proves
// (concurrency + per-run isolation + grounding persistence), since MockGitClient
// supplies the diff directly and grounding runs against that, not `pr_files`.
const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test', INTENT_ENABLED: 'false' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (only new-side lines 10-13 exist),
 * so a finding citing line 999 sits outside every hunk and grounding drops
 * it — same fixture shape as reviews.it.test.ts's DIFF.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const CLEAN_REVIEW: Review = {
  verdict: 'approve',
  summary: 'Nothing to flag.',
  score: 90,
  findings: [],
};

/** A finding citing line 999 — outside every diff hunk; grounding must drop it. */
const HALLUCINATED_REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Found an issue.',
  score: 40,
  findings: [
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding outside every diff hunk',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line is not part of the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

/**
 * Dispatches behavior per `req.model` so several agents sharing ONE provider
 * (and therefore one container.llm() instance) can each get distinct,
 * independently-timed behavior within a single executeRuns() call:
 *   - 'throw-model' sleeps then rejects, standing in for a real provider failure.
 *   - 'ground-model' sleeps then returns a finding outside every diff hunk.
 *   - anything else sleeps then returns a clean, finding-free review.
 * A REAL setTimeout (never vi.useFakeTimers()) is required here — fake timers
 * don't let PQueue's concurrent jobs race realistically (server/insights/gotchas.md
 * 2026-08-21 precedent in reviews.it.test.ts's SlowLLM).
 */
class DispatchLLM extends MockLLMProvider {
  constructor(private sleepMs = 400) {
    super('openai', {});
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise((r) => setTimeout(r, this.sleepMs));
    this.calls.push({ method: 'completeStructured', req });
    if (req.model === 'throw-model') {
      throw new Error('Simulated provider outage');
    }
    const fixture = req.model === 'ground-model' ? HALLUCINATED_REVIEW : CLEAN_REVIEW;
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

d('T8 run-executor concurrency + grounding-rejected persistence (AC-49, AC-50)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
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

  async function setupRepoAndPr() {
    const name = `run-executor-concurrency-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1000 + repoSeq,
        title: 'Concurrent multi-agent run',
        author: 'marisa.koch',
        branch: 'feat/concurrency',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    // No `pr_files` row on purpose — MockGitClient supplies the diff
    // directly (grounding runs against that), and an empty `pr_files` set
    // makes the post-loop brief hook's `selectFilesToSummarize` return `[]`,
    // skipping its own model call (see the `config()` comment above).
    return { repo: repo!, pr: pr! };
  }

  async function makeAgent(model: string): Promise<AgentRow> {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: model, provider: 'openai', model, systemPrompt: 'Review this diff.' })
      .returning();
    return agent!;
  }

  it('runs 4 agents concurrently — well under 4x the per-agent latency, all reach done', async () => {
    const SLEEP_MS = 400;
    const llm = new DispatchLLM(SLEEP_MS);
    const app = await appWith(llm);
    const container = app.container;
    const executor = new ReviewRunExecutor(container, container.reviewRepo, container.agentsRepo);
    const { repo, pr } = await setupRepoAndPr();

    const agents = await Promise.all(['ok-1', 'ok-2', 'ok-3', 'ok-4'].map(makeAgent));
    const jobs = await Promise.all(
      agents.map(async (agent) => ({
        agent,
        runId: await container.reviewRepo.createAgentRun({
          workspaceId,
          agentId: agent.id,
          prId: pr!.id,
          provider: agent.provider,
          model: agent.model,
        }),
      })),
    );

    const pull = (await container.reviewRepo.getPull(workspaceId, pr!.id))!;
    const repoRow = (await container.reviewRepo.getRepo(repo!.id))!;

    const start = Date.now();
    await executor.executeRuns(workspaceId, pull, repoRow, jobs);
    const elapsedMs = Date.now() - start;

    // Sequential would be >= 4 * SLEEP_MS = 1600ms; concurrent (queue width 4,
    // default reviewRunConcurrency) should land close to a single SLEEP_MS
    // sleep. A generous relative bound (2.5x one sleep, strictly below the
    // 4x sequential bound) avoids flaking on a loaded CI runner while still
    // catching a regression to fully-sequential execution.
    expect(elapsedMs).toBeLessThan(SLEEP_MS * 2.5);

    const rows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr!.id));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.status).toBe('done');
    }

    await app.close();
  });

  it('isolates a failing agent from its siblings and persists grounding rejections (AC-49, AC-50)', async () => {
    const llm = new DispatchLLM(200);
    const app = await appWith(llm);
    const container = app.container;
    const executor = new ReviewRunExecutor(container, container.reviewRepo, container.agentsRepo);
    const { repo, pr } = await setupRepoAndPr();

    const agents = await Promise.all(['ok-a', 'throw-model', 'ground-model', 'ok-b'].map(makeAgent));
    const jobs = await Promise.all(
      agents.map(async (agent) => ({
        agent,
        runId: await container.reviewRepo.createAgentRun({
          workspaceId,
          agentId: agent.id,
          prId: pr!.id,
          provider: agent.provider,
          model: agent.model,
        }),
      })),
    );
    const byModel = new Map(jobs.map((j) => [j.agent.model, j.runId]));

    const pull = (await container.reviewRepo.getPull(workspaceId, pr!.id))!;
    const repoRow = (await container.reviewRepo.getRepo(repo!.id))!;

    // executeRuns itself must never throw/reject just because one job did.
    await expect(executor.executeRuns(workspaceId, pull, repoRow, jobs)).resolves.toBeUndefined();

    const rows = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr!.id));
    const byId = new Map(rows.map((r) => [r.id, r]));

    // The throwing agent's run failed, with its error text persisted...
    const failed = byId.get(byModel.get('throw-model')!)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Simulated provider outage');

    // ...while its three siblings all still reached 'done' (AC-49).
    for (const model of ['ok-a', 'ground-model', 'ok-b']) {
      const row = byId.get(byModel.get(model)!)!;
      expect(row.status).toBe('done');
    }

    // The run whose model cited a line outside every diff hunk persists a
    // non-empty grounding_rejected array carrying that finding's file, range
    // and the gate's reason (AC-50, persistence half).
    const grounded = byId.get(byModel.get('ground-model')!)!;
    expect(grounded.groundingRejected).not.toBeNull();
    expect(grounded.groundingRejected).toHaveLength(1);
    const rejection = grounded.groundingRejected![0]!;
    expect(rejection.file).toBe('src/config.ts');
    expect(rejection.start_line).toBe(999);
    expect(rejection.end_line).toBe(999);
    expect(rejection.title).toBe('Phantom finding outside every diff hunk');
    expect(typeof rejection.reason).toBe('string');
    expect(rejection.reason.length).toBeGreaterThan(0);

    // The clean agents' runs recorded no grounding rejections at all.
    for (const model of ['ok-a', 'ok-b']) {
      const row = byId.get(byModel.get(model)!)!;
      expect(row.groundingRejected).toBeNull();
    }

    await app.close();
  });
});
