import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[seed-test-quality-reviewer] Docker not available — skipping integration tests.');
}

/**
 * L02 seed additions: the Test Quality Reviewer agent, its 3 seeded skills
 * (uncovered-branch-gate, corner-case-checklist, mock-overuse) linked in
 * order, and the 4th skill (flaky-test-patterns) that ships via the community
 * catalog instead of the DB seed. Also proves re-running `seed()` is
 * idempotent: no duplicate agent, skill, or agent_skills rows.
 */
d('seed: Test Quality Reviewer + skills', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    // Run seed() TWICE in a row — the second run must not throw and must not
    // create duplicate agents/skills/agent_skills rows.
    await seed(pg.handle.db);
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('a single Test Quality Reviewer agent exists after seeding twice', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    const agents = res.json() as Array<{ id: string; name: string }>;
    const matches = agents.filter((a) => a.name === 'Test Quality Reviewer');
    expect(matches).toHaveLength(1);
    await app.close();
  });

  it('has exactly 3 linked skills in order: uncovered-branch-gate, corner-case-checklist, mock-overuse', async () => {
    const app = await makeApp();
    const agentsRes = await app.inject({ method: 'GET', url: '/agents' });
    const agents = agentsRes.json() as Array<{ id: string; name: string }>;
    const agent = agents.find((a) => a.name === 'Test Quality Reviewer');
    expect(agent).toBeDefined();

    const linksRes = await app.inject({ method: 'GET', url: `/agents/${agent!.id}/skills` });
    expect(linksRes.statusCode).toBe(200);
    const links = linksRes.json() as Array<{ skill_id: string; order: number }>;
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.order)).toEqual([0, 1, 2]);

    // Resolve each linked skill_id to its name to confirm the exact order.
    const skillsRes = await app.inject({ method: 'GET', url: '/skills' });
    const skills = skillsRes.json() as Array<{ id: string; name: string }>;
    const nameById = new Map(skills.map((s) => [s.id, s.name]));
    const orderedNames = [...links]
      .sort((a, b) => a.order - b.order)
      .map((l) => nameById.get(l.skill_id));
    expect(orderedNames).toEqual([
      'uncovered-branch-gate',
      'corner-case-checklist',
      'mock-overuse',
    ]);
    await app.close();
  });

  it('re-seeding does not duplicate the 3 seeded skills or agent_skills rows', async () => {
    const app = await makeApp();
    const skillsRes = await app.inject({ method: 'GET', url: '/skills' });
    const skills = skillsRes.json() as Array<{ name: string }>;
    for (const name of ['uncovered-branch-gate', 'corner-case-checklist', 'mock-overuse']) {
      expect(skills.filter((s) => s.name === name)).toHaveLength(1);
    }
    await app.close();
  });

  it('GET /skills/community includes the flaky-test-patterns entry', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/skills/community' });
    expect(res.statusCode).toBe(200);
    const entries = res.json() as Array<{ repo: string; name: string }>;
    const flaky = entries.find((e) => e.repo === 'devdigest-community/flaky-test-patterns');
    expect(flaky).toBeDefined();
    expect(flaky?.name).toBe('Flaky Test Patterns');
    await app.close();
  });
});
