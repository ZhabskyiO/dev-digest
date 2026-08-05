import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsService } from '../src/modules/skills/service.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills module — CRUD + versioning, cross-workspace isolation, attach/reorder
 * via the existing agents-skills link endpoint, import preview (persists
 * nothing), and the usage rollup's zero-rows denominator behavior.
 */
d('skills routes', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
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

  const createBody = {
    name: 'Security Basics',
    description: 'Flags obvious security issues.',
    type: 'security' as const,
    body: '# Security Basics\n\nFlag hardcoded secrets.',
  };

  const agentBody = {
    name: 'Skills Test Agent',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff.',
  };

  it('create returns 201 with the right shape', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill).toMatchObject({
      name: createBody.name,
      description: createBody.description,
      type: createBody.type,
      body: createBody.body,
      source: 'manual',
      enabled: true,
      version: 1,
      evidence_files: null,
    });
    expect(typeof skill.id).toBe('string');
    await app.close();
  });

  it('get returns the created skill', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/skills/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: created.id, name: createBody.name });
    await app.close();
  });

  it('list includes a newly created skill', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[];

    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const after = (await app.inject({ method: 'GET', url: '/skills' })).json() as Array<{
      id: string;
    }>;
    expect(after.length).toBe(before.length + 1);
    expect(after.map((s) => s.id)).toContain(created.id);
    await app.close();
  });

  it('a body-changing update bumps version to 2', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: '# Security Basics v2\n\nUpdated rule.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(2);
    await app.close();
  });

  it('delete returns { ok: true }, and get-after-delete is 404', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const del = await app.inject({ method: 'DELETE', url: `/skills/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    const get = await app.inject({ method: 'GET', url: `/skills/${created.id}` });
    expect(get.statusCode).toBe(404);
    await app.close();
  });

  it('422 on a malformed uuid in the :id param', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/skills/not-a-uuid' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('PUT /skills/:id — a body edit creates a new skill_versions row (newest first); name/enabled-only edits do not', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const versionsBefore = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json() as Array<{ version: number }>;
    expect(versionsBefore).toHaveLength(1);

    // Name-only edit: no new version.
    await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { name: 'Renamed Skill' },
    });
    // Enabled-only edit: no new version.
    await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { enabled: false },
    });

    const versionsAfterNonBodyEdits = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json() as Array<{ version: number }>;
    expect(versionsAfterNonBodyEdits).toHaveLength(1);

    // Body edit: new version, list grows by one, newest first.
    await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: '# Renamed Skill v2\n\nNew body.' },
    });

    const versionsAfterBodyEdit = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json() as Array<{ version: number }>;
    expect(versionsAfterBodyEdit).toHaveLength(2);
    expect(versionsAfterBodyEdit.map((v) => v.version)).toEqual([2, 1]);
    await app.close();
  });

  it('attach and reorder via POST /agents/:id/skills reflects order in GET /agents/:id/skills', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: agentBody })
    ).json().id as string;

    const skillA = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...createBody, name: 'Skill A' },
      })
    ).json().id as string;
    const skillB = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...createBody, name: 'Skill B' },
      })
    ).json().id as string;
    const skillC = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...createBody, name: 'Skill C' },
      })
    ).json().id as string;

    const attach = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillA, skillB, skillC] },
    });
    expect(attach.statusCode).toBe(200);

    const linked = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })
    ).json() as Array<{ skill_id: string; order: number }>;
    expect(linked.map((l) => l.skill_id)).toEqual([skillA, skillB, skillC]);

    // Reorder: C, A, B.
    const reorder = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillC, skillA, skillB] },
    });
    expect(reorder.statusCode).toBe(200);

    const reordered = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })
    ).json() as Array<{ skill_id: string; order: number }>;
    expect(reordered.map((l) => l.skill_id)).toEqual([skillC, skillA, skillB]);
    await app.close();
  });

  it('POST /skills/import/preview persists nothing', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[];

    const preview = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { source: 'community', id: 'conventional-commits/conventionalcommits.org' },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body.name).toBe('Conventional Commits');
    expect(body.source).toBe('community');
    expect(typeof body.body).toBe('string');

    const after = (await app.inject({ method: 'GET', url: '/skills' })).json() as unknown[];
    expect(after.length).toBe(before.length);
    await app.close();
  });

  it("GET /skills/usage's zero-rows case: an agent + skills with no run_skills rows yet", async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: agentBody })
    ).json().id as string;
    await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...createBody, name: 'Unused Skill A' },
    });
    await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...createBody, name: 'Unused Skill B' },
    });

    // No run_skills rows exist for this agent — per service.usage, the
    // denominator (skillUsingRunCount) is 0, and with zero rows returned by
    // usageByAgent there is nothing to map, so the endpoint returns [].
    // TODO: once the run-executor integration (a later task) writes real
    // run_skills rows, add a case covering the actual percentage math
    // (runs / skillUsingRunCount * 100, rounded) against real data.
    const res = await app.inject({
      method: 'GET',
      url: `/skills/usage?agent_id=${agentId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('is cross-workspace isolated: a skill in another workspace is invisible to the default workspace, and vice versa', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-skills-ws' }).returning();

    const service = new SkillsService({ db } as unknown as Container);
    const foreign = await service.create(otherWs!.id, {
      name: 'Foreign Skill',
      description: 'Belongs to another workspace',
      type: 'security',
      source: 'manual',
      body: '# Foreign',
    });

    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    // Owner workspace can read it; the default workspace cannot (404-shaped: undefined).
    expect(await service.get(otherWs!.id, foreign.id)).toMatchObject({ id: foreign.id });
    expect(await service.get(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.listVersions(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.delete(defaultWs!, foreign.id)).toBe(false);

    // Still there, since the cross-workspace delete above was a no-op.
    expect(await service.get(otherWs!.id, foreign.id)).toMatchObject({ id: foreign.id });
  });
});
