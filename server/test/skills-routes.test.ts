/**
 * `PUT /skills/:id` — schema-layer regression for the same defect fixed in
 * `modules/project-context/routes.ts`'s `PUT /agents/:id/context`
 * (server/insights/gotchas.md, 2026-08-20): the route's `context` field was
 * built straight from the unrefined mirrored `@devdigest/shared` contract
 * (`ProjectContextRef`), so a non-UUID `repo_id` or a hostile `path` sailed
 * past validation and only failed downstream (a Postgres 22P02 500 for the
 * id, or reached the filesystem-adjacent service for the path) instead of a
 * clean 422 before the handler runs. Both routes now share
 * `_shared/context-ref.ts`'s `ContextRefBody`.
 *
 * Route-level (`app.inject`), no DB: `SkillsService` builds its own
 * `SkillsRepository` straight from `container.db` (never `container.skillsRepo`,
 * see server/insights/INSIGHTS.md's `LocalReviewService` entry for the same
 * shape), so `buildApp({ db })` is given a minimal chain-stub covering exactly
 * the query shapes `SkillsRepository.getById`/`.update` issue — same technique
 * `test/skills-service.test.ts` uses at the service layer, one level up here
 * to also prove the route's own schema gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import * as schema from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import type { SkillRow } from '../src/modules/skills/repository.js';
import type { ProjectContextService } from '../src/modules/project-context/service.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AUTH = new MockAuthProvider(
  { id: 'u1', email: 'you@local', name: 'You' },
  { id: 'ws-1', name: 'default' },
);

const SKILL_ID = '44444444-4444-4444-4444-444444444444';
const REPO_ID = '11111111-1111-1111-1111-111111111111';

function makeSkillRow(): SkillRow {
  return {
    id: SKILL_ID,
    workspaceId: 'ws-1',
    name: 'Test skill',
    description: '',
    type: 'custom',
    source: 'manual',
    body: '# body',
    enabled: true,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SkillRow;
}

/**
 * A minimal chain-stub covering exactly the query shapes
 * `SkillsRepository.getById`/`.update` issue: a plain `select().from(t.skills)
 * .where()` (used both outside and inside the transaction), a `select().from
 * (t.skillVersions).where().orderBy().limit()` (`lastContext`, always reports
 * no prior snapshot), and a `transaction(tx => ...)` whose `tx` supports the
 * same `select`, plus `update().set().where().returning()` and `insert()
 * .values().onConflictDoNothing()`. Never touches a real Postgres.
 */
function makeFakeDb(skillRow: SkillRow): Db {
  const selectChain = (table: unknown) => {
    const rows = table === schema.skills ? [skillRow] : []; // skillVersions: no prior snapshot
    const chain = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
    };
    return chain;
  };
  const select = () => ({ from: (table: unknown) => selectChain(table) });

  const tx = {
    select,
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [{ ...skillRow }] }),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: async () => undefined }),
    }),
  };

  return {
    select,
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Db;
}

describe('PUT /skills/:id — context ref validation (route-level, no DB)', () => {
  it('rejects a non-UUID repo_id in context with 422 before the service runs', async () => {
    const db = makeFakeDb(makeSkillRow());
    const app = await buildApp({ config, db, overrides: { auth: AUTH } });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${SKILL_ID}`,
      payload: { context: [{ repo_id: 'not-a-uuid', path: 'specs/a.md' }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('rejects a "../" context path with 422', async () => {
    const db = makeFakeDb(makeSkillRow());
    const app = await buildApp({ config, db, overrides: { auth: AUTH } });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${SKILL_ID}`,
      payload: { context: [{ repo_id: REPO_ID, path: '../etc/passwd' }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('rejects a leading-slash context path with 422', async () => {
    const db = makeFakeDb(makeSkillRow());
    const app = await buildApp({ config, db, overrides: { auth: AUTH } });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${SKILL_ID}`,
      payload: { context: [{ repo_id: REPO_ID, path: '/etc/passwd' }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('still succeeds with a well-formed context array', async () => {
    const db = makeFakeDb(makeSkillRow());
    const setSkillContext = vi.fn(async () => undefined);
    const projectContext = { setSkillContext } as unknown as ProjectContextService;
    const app = await buildApp({ config, db, overrides: { auth: AUTH, projectContext } });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${SKILL_ID}`,
      payload: { context: [{ repo_id: REPO_ID, path: 'specs/a.md' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(setSkillContext).toHaveBeenCalledWith('ws-1', SKILL_ID, [
      { repo_id: REPO_ID, path: 'specs/a.md' },
    ]);
    await app.close();
  });

  it('still succeeds when context is omitted entirely (it is .optional())', async () => {
    const db = makeFakeDb(makeSkillRow());
    // No `projectContext` override: `setSkillContext` must NEVER be reached
    // when `context` is absent from the body, so the real (DB-backed)
    // service getter would blow up if this test's schema regressed and made
    // `context` implicitly required.
    const app = await buildApp({ config, db, overrides: { auth: AUTH } });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${SKILL_ID}`,
      payload: { name: 'Renamed skill' },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
