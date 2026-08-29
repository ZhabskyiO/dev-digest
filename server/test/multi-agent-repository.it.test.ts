import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[multi-agent-repository] Docker not available — skipping integration tests.');
}

/**
 * T4 — the DB access the multi-agent review feature needs, added to
 * `ReviewRepository` (AC-17, AC-18, AC-20, AC-22, AC-50).
 *
 * Fixtures are planted directly via `t.*` inserts rather than through a
 * run-executor/service — those land in later tasks. Each test uses its own
 * repo/PR/agents so tests can run against the same shared Postgres fixture
 * without interfering with each other.
 */
d('ReviewRepository — multi-agent review', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let repo: ReviewRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    repo = new ReviewRepository(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace' })
      .returning();
    otherWorkspaceId = otherWs!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepoRow(wsId: string, label: string): Promise<string> {
    const name = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return row!.id;
  }

  async function makePr(wsId: string, repoId: string, number: number): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId,
        number,
        title: 'Multi-agent PR',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: `sha-${number}`,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return row!.id;
  }

  async function makeAgent(wsId: string, name: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: wsId, name, provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'review' })
      .returning();
    return row!.id;
  }

  describe('createMultiAgentRun / latestMultiRunForPull / runsForMultiRun', () => {
    it('a created multi-run + three linked agent runs resolve in both directions', async () => {
      const repoId = await makeRepoRow(workspaceId, 'multi-run-repo');
      const prId = await makePr(workspaceId, repoId, 1);
      const agentA = await makeAgent(workspaceId, 'Agent A');
      const agentB = await makeAgent(workspaceId, 'Agent B');
      const agentC = await makeAgent(workspaceId, 'Agent C');

      const multiRunId = await repo.createMultiAgentRun({ workspaceId, prId });

      const runA = await repo.createAgentRun({
        workspaceId,
        agentId: agentA,
        prId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        multiRunId,
      });
      const runB = await repo.createAgentRun({
        workspaceId,
        agentId: agentB,
        prId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        multiRunId,
      });
      const runC = await repo.createAgentRun({
        workspaceId,
        agentId: agentC,
        prId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        multiRunId,
      });

      const rejection = [
        {
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          title: 'Unverified line',
          reason: 'no matching diff line',
        },
      ];
      await repo.completeAgentRun(runA, {
        status: 'done',
        durationMs: 1000,
        tokensIn: 100,
        tokensOut: 50,
        findingsCount: 1,
        grounding: 'ok',
        groundingRejected: rejection,
      });
      await repo.completeAgentRun(runB, {
        status: 'done',
        durationMs: 2000,
        tokensIn: 100,
        tokensOut: 50,
        findingsCount: 0,
        grounding: 'ok',
      });
      await repo.completeAgentRun(runC, {
        status: 'failed',
        durationMs: 500,
        tokensIn: 0,
        tokensOut: 0,
        findingsCount: 0,
        grounding: 'none',
        error: 'timeout',
      });

      // PR -> multi-run direction.
      const latest = await repo.latestMultiRunForPull(workspaceId, prId);
      expect(latest?.id).toBe(multiRunId);
      expect(latest?.prId).toBe(prId);

      // multi-run -> runs direction.
      const runs = await repo.runsForMultiRun(multiRunId);
      expect(runs).toHaveLength(3);
      const byId = new Map(runs.map((r) => [r.run.id, r]));
      expect(byId.get(runA)?.agentName).toBe('Agent A');
      expect(byId.get(runA)?.run.groundingRejected).toEqual(rejection);
      expect(byId.get(runB)?.agentName).toBe('Agent B');
      expect(byId.get(runB)?.run.groundingRejected).toBeNull();
      expect(byId.get(runC)?.agentName).toBe('Agent C');
      expect(byId.get(runC)?.run.status).toBe('failed');

      // Reverse link persisted on each spawned run.
      for (const r of runs) {
        expect(r.run.multiRunId).toBe(multiRunId);
      }
    });

    it('latestMultiRunForPull returns undefined for a PR in another workspace', async () => {
      const repoId = await makeRepoRow(workspaceId, 'cross-ws-repo');
      const prId = await makePr(workspaceId, repoId, 2);
      await repo.createMultiAgentRun({ workspaceId, prId });

      const result = await repo.latestMultiRunForPull(otherWorkspaceId, prId);
      expect(result).toBeUndefined();
    });
  });

  describe('recentCompletedRunStats', () => {
    it('returns at most `limit` rows per agent, workspace-wide, excluding non-done runs', async () => {
      const repoId = await makeRepoRow(workspaceId, 'stats-repo');
      const prId = await makePr(workspaceId, repoId, 3);
      const agentId = await makeAgent(workspaceId, 'Stats Agent');

      const base = Date.now();
      const doneRuns = [
        { durationMs: 111, costUsd: 0.11, offsetMs: 0 },
        { durationMs: 222, costUsd: 0.22, offsetMs: 1000 },
        { durationMs: 333, costUsd: 0.33, offsetMs: 2000 },
        { durationMs: 444, costUsd: 0.44, offsetMs: 3000 },
      ];
      for (const run of doneRuns) {
        await pg.handle.db.insert(t.agentRuns).values({
          workspaceId,
          agentId,
          prId,
          status: 'done',
          durationMs: run.durationMs,
          costUsd: run.costUsd,
          ranAt: new Date(base + run.offsetMs),
        });
      }
      // A failed run, most recent of all — must never be counted or returned.
      await pg.handle.db.insert(t.agentRuns).values({
        workspaceId,
        agentId,
        prId,
        status: 'failed',
        durationMs: 999,
        costUsd: 0.99,
        ranAt: new Date(base + 4000),
      });

      const stats = await repo.recentCompletedRunStats(workspaceId, [agentId], 2);
      const forAgent = stats.get(agentId);
      expect(forAgent).toHaveLength(2);
      // Newest-first: offsets 3000 and 2000 → durationMs 444 and 333.
      expect(forAgent).toEqual([
        { durationMs: 444, costUsd: 0.44 },
        { durationMs: 333, costUsd: 0.33 },
      ]);
    });
  });

  describe('latestCompletedSummaryForPull', () => {
    it('returns null for an agent with workspace history but no completed run on that PR', async () => {
      const repoId = await makeRepoRow(workspaceId, 'summary-repo');
      const prA = await makePr(workspaceId, repoId, 4);
      const prB = await makePr(workspaceId, repoId, 5);
      const agentId = await makeAgent(workspaceId, 'Summary Agent');

      // Completed run + review with a summary, but on PR A, not PR B.
      const [runRow] = await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId, agentId, prId: prA, status: 'done', durationMs: 10, costUsd: 0.01 })
        .returning();
      await pg.handle.db.insert(t.reviews).values({
        workspaceId,
        prId: prA,
        agentId,
        runId: runRow!.id,
        kind: 'review',
        verdict: 'approve',
        summary: 'Looks fine on PR A.',
        score: 90,
        model: 'gpt-4o-mini',
      });

      const summariesForB = await repo.latestCompletedSummaryForPull(workspaceId, prB, [agentId]);
      expect(summariesForB.get(agentId)).toBeNull();

      // Sanity: the same agent DOES resolve a summary when asked about PR A.
      const summariesForA = await repo.latestCompletedSummaryForPull(workspaceId, prA, [agentId]);
      expect(summariesForA.get(agentId)).toBe('Looks fine on PR A.');
    });
  });

  describe('reviewsWithFindingsForRunIds', () => {
    it('returns reviews with their findings for the given run ids', async () => {
      const repoId = await makeRepoRow(workspaceId, 'findings-repo');
      const prId = await makePr(workspaceId, repoId, 6);
      const agentId = await makeAgent(workspaceId, 'Findings Agent');

      const runId = await repo.createAgentRun({
        workspaceId,
        agentId,
        prId,
        provider: 'openai',
        model: 'gpt-4o-mini',
      });
      const review = await repo.insertReview({
        workspaceId,
        prId,
        agentId,
        runId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'One issue.',
        score: 60,
        model: 'gpt-4o-mini',
      });
      await repo.insertFindings(review.id, [
        {
          id: 'f-1',
          file: 'src/config.ts',
          start_line: 5,
          end_line: 5,
          severity: 'WARNING',
          category: 'security',
          title: 'Hardcoded key',
          rationale: 'Do not hardcode secrets.',
          confidence: 0.9,
        },
      ]);

      const results = await repo.reviewsWithFindingsForRunIds([runId]);
      expect(results).toHaveLength(1);
      expect(results[0]!.review.id).toBe(review.id);
      expect(results[0]!.findings).toHaveLength(1);
      expect(results[0]!.findings[0]!.title).toBe('Hardcoded key');
    });
  });
});
