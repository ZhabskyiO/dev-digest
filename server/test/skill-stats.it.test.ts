import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { MAX_STATS_DAYS } from '../src/modules/skills/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skill-stats] Docker not available — skipping integration tests.');
}

/**
 * GET /skills/:id/stats and GET /skills/stats.
 *
 * Fixtures are inserted directly rather than produced by running a review:
 * `pnpm db:seed` creates ZERO agent_runs, ZERO run_skills and ZERO
 * skill_versions, so nothing that walks
 * findings → reviews.run_id → agent_runs → run_skills can be exercised against
 * seeded data at all. Every number here has to be planted.
 */
d('skill stats', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  let agentId: string;
  /** Attached to 2 agents, pulled by 2 of 3 runs, findings triaged. */
  let hotSkillId: string;
  /** Attached to 1 agent, never pulled by a run. */
  let coldSkillId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;

    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await db.select().from(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
    repoId = repo!.id;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 991,
        title: 'Stats fixture',
        author: 'tester',
        branch: 'feat/stats',
        base: 'main',
        headSha: 'stats0fixture',
        status: 'open',
      })
      .returning();
    prId = pr!.id;

    const [hot] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'stats-hot-skill',
        description: 'pulled often',
        type: 'rubric',
        source: 'manual',
        body: '# hot',
      })
      .returning();
    hotSkillId = hot!.id;

    const [cold] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'stats-cold-skill',
        description: 'never pulled',
        type: 'custom',
        source: 'manual',
        body: '# cold',
      })
      .returning();
    coldSkillId = cold!.id;

    const agents = await db
      .insert(t.agents)
      .values([
        { workspaceId, name: 'Stats Agent A', description: '', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'r' },
        { workspaceId, name: 'Stats Agent B', description: '', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'r' },
      ])
      .returning();
    agentId = agents[0]!.id;

    // hot: linked to both agents; cold: only the first.
    await db.insert(t.agentSkills).values([
      { agentId: agents[0]!.id, skillId: hotSkillId, order: 0 },
      { agentId: agents[1]!.id, skillId: hotSkillId, order: 0 },
      { agentId: agents[0]!.id, skillId: coldSkillId, order: 1 },
    ]);

    // Three skill-using runs; hot was attached to two of them → pull_pct 67%.
    const runs = await db
      .insert(t.agentRuns)
      .values([
        { workspaceId, agentId, prId, status: 'completed' },
        { workspaceId, agentId, prId, status: 'completed' },
        { workspaceId, agentId, prId, status: 'completed' },
      ])
      .returning();

    await db.insert(t.runSkills).values([
      { runId: runs[0]!.id, skillId: hotSkillId, order: 0 },
      { runId: runs[1]!.id, skillId: hotSkillId, order: 0 },
      // Third run attached some other skill, so it counts toward the
      // denominator without crediting `hot`.
      { runId: runs[2]!.id, skillId: coldSkillId, order: 0 },
    ]);

    // One review per hot run, each with findings in a known triage state.
    const [reviewA] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, runId: runs[0]!.id, agentId, kind: 'review', verdict: 'request_changes' })
      .returning();
    const [reviewB] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, runId: runs[1]!.id, agentId, kind: 'review', verdict: 'comment' })
      .returning();

    const finding = (reviewId: string, category: string, state: 'accepted' | 'dismissed' | 'open') => ({
      reviewId,
      file: 'src/a.ts',
      startLine: 1,
      endLine: 2,
      severity: 'WARNING',
      category,
      title: `${category} finding`,
      rationale: 'because',
      confidence: 0.8,
      ...(state === 'accepted' ? { acceptedAt: new Date() } : {}),
      ...(state === 'dismissed' ? { dismissedAt: new Date() } : {}),
    });

    // 3 accepted, 1 dismissed, 1 untouched → accept_rate = 3/4 = 75%,
    // findings = 5. The untouched one must NOT count as a rejection.
    await db.insert(t.findings).values([
      finding(reviewA!.id, 'security', 'accepted'),
      finding(reviewA!.id, 'security', 'accepted'),
      finding(reviewA!.id, 'bug', 'dismissed'),
      finding(reviewB!.id, 'perf', 'accepted'),
      finding(reviewB!.id, 'style', 'open'),
    ]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('aggregates agents, pulls, accept rate and findings for one skill', async () => {
    const app = await makeApp();
    const res = await app.inject({ url: `/skills/${hotSkillId}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();

    expect(stats.agents_using).toBe(2);
    expect(stats.runs).toBe(2);
    expect(stats.pull_pct).toBe(67); // 2 of 3 skill-using runs
    expect(stats.accept_rate).toBe(75); // 3 accepted of 4 triaged — not 3 of 5
    expect(stats.findings).toBe(5);
    await app.close();
  });

  it('breaks findings down by category, busiest first', async () => {
    const app = await makeApp();
    const stats = (await app.inject({ url: `/skills/${hotSkillId}/stats` })).json();
    expect(stats.by_category[0]).toEqual({ category: 'security', count: 2 });
    expect(stats.by_category.map((c: { category: string }) => c.category).sort()).toEqual([
      'bug',
      'perf',
      'security',
      'style',
    ]);
    await app.close();
  });

  it('returns nulls, not zeros, for a skill with no runs', async () => {
    const app = await makeApp();
    const stats = (await app.inject({ url: `/skills/${coldSkillId}/stats` })).json();
    expect(stats.agents_using).toBe(1); // it IS attached to an agent
    expect(stats.runs).toBe(1); // …and that run pulled it
    expect(stats.findings).toBe(0);
    // No finding was ever triaged for this skill → the ratio is unknown, not 0%.
    expect(stats.accept_rate).toBeNull();
    expect(stats.by_category).toEqual([]);
    await app.close();
  });

  it('a seeded skill with no runs at all reports null pull/accept', async () => {
    const app = await makeApp();
    const [seeded] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.name, 'uncovered-branch-gate'));
    const stats = (await app.inject({ url: `/skills/${seeded!.id}/stats` })).json();
    expect(stats.runs).toBe(0);
    expect(stats.pull_pct).toBe(0); // there ARE skill-using runs, this skill is in none
    expect(stats.accept_rate).toBeNull();
    expect(stats.findings).toBe(0);
    await app.close();
  });

  it('clamps an absurd ?days= instead of scanning forever', async () => {
    const app = await makeApp();
    const wide = (await app.inject({ url: `/skills/${hotSkillId}/stats?days=100000` })).json();
    const capped = (
      await app.inject({ url: `/skills/${hotSkillId}/stats?days=${MAX_STATS_DAYS}` })
    ).json();
    expect(wide).toEqual(capped);
    await app.close();
  });

  it('a window that excludes the runs drops them out', async () => {
    const app = await makeApp();
    // Age the runs past a 1-day window.
    await pg.handle.db
      .update(t.agentRuns)
      .set({ ranAt: new Date(Date.now() - 10 * 86400000) })
      .where(eq(t.agentRuns.prId, prId));

    const stats = (await app.inject({ url: `/skills/${hotSkillId}/stats?days=1` })).json();
    expect(stats.runs).toBe(0);
    expect(stats.findings).toBe(0);
    expect(stats.pull_pct).toBeNull(); // no skill-using runs in window at all
    expect(stats.accept_rate).toBeNull();
    // Agent attachment is configuration, not history — it survives the window.
    expect(stats.agents_using).toBe(2);
    await app.close();
  });

  it('404s for an unknown skill id', async () => {
    const app = await makeApp();
    const res = await app.inject({
      url: '/skills/00000000-0000-0000-0000-000000000000/stats',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /skills/stats returns a row for every skill, including unused ones', async () => {
    const app = await makeApp();
    const res = await app.inject({ url: '/skills/stats' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { skill_id: string; agents_using: number }[];

    const all = (await app.inject({ url: '/skills' })).json() as { id: string }[];
    expect(rows).toHaveLength(all.length);

    const hot = rows.find((r) => r.skill_id === hotSkillId);
    expect(hot).toMatchObject({ agents_using: 2 });

    // A skill nothing references at all still gets a row — a left join would
    // drop it, and the rail has to render every skill.
    const orphan = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'stats-orphan-skill',
          description: 'attached to nothing',
          type: 'custom',
          body: '# orphan',
        },
      })
    ).json() as { id: string };
    const after = (await app.inject({ url: '/skills/stats' })).json() as {
      skill_id: string;
      agents_using: number;
      pull_pct: number | null;
      accept_rate: number | null;
    }[];
    expect(after.find((r) => r.skill_id === orphan.id)).toEqual({
      skill_id: orphan.id,
      agents_using: 0,
      pull_pct: 0,
      accept_rate: null,
    });
    await app.close();
  });

  it('/skills/stats is not shadowed by the /skills/:id uuid route', async () => {
    const app = await makeApp();
    // Registered before /skills/:id, so "stats" must not be parsed as an id.
    const res = await app.inject({ url: '/skills/stats' });
    expect(res.statusCode).not.toBe(422);
    expect(Array.isArray(res.json())).toBe(true);
    await app.close();
  });
});
