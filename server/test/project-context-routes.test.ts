/**
 * T11 — project-context route smoke tests. No DB: every dependency the
 * routes touch (`projectContext`, `agentsRepo`, `skillsRepo`, `reviewRepo`)
 * is injected via `ContainerOverrides`, mirroring `routes-smoke.test.ts`'s
 * pattern. `MockAuthProvider` fixes the caller's workspace to `'ws-1'` so
 * cross-workspace rejections can be asserted deterministically.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import type { ProjectContextService } from '../src/modules/project-context/service.js';
import type { AgentsRepository } from '../src/modules/agents/repository.js';
import type { SkillsRepository } from '../src/modules/skills/repository.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AUTH = new MockAuthProvider(
  { id: 'u1', email: 'you@local', name: 'You' },
  { id: 'ws-1', name: 'default' },
);

const REPO_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REPO_ID = '22222222-2222-2222-2222-222222222222';
const AGENT_ID = '33333333-3333-3333-3333-333333333333';

describe('project-context routes (no DB)', () => {
  it('GET /repos/:id/context/documents returns {documents: [], reason: "not_cloned"} (AC-4)', async () => {
    const list = vi.fn(async () => ({
      documents: [],
      reason: 'not_cloned' as const,
      scanned_at: new Date().toISOString(),
      roots: ['specs', 'docs', 'insights'],
      conventional_filenames: ['insights.md'],
      budget_tokens: 12_000,
      clone_head: null,
    }));
    const projectContext = { list } as unknown as ProjectContextService;
    const app = await buildApp({ config, overrides: { auth: AUTH, projectContext } });

    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context/documents` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ documents: [], reason: 'not_cloned' });
    expect(list).toHaveBeenCalledWith('ws-1', REPO_ID);
    await app.close();
  });

  it('grep-verifiable: rescan carries config.rateLimit.max = 6', async () => {
    // Behavioural assertion is impossible under app.inject() — rate-limit
    // registration is skipped entirely in test mode (server/insights/gotchas.md,
    // 2026-08-09). Route config is still exercised: proves the handler
    // itself works, and the max:6 value is checked by grep separately.
    const rescan = vi.fn(async () => ({
      documents: [],
      scanned_at: new Date().toISOString(),
      roots: [],
      conventional_filenames: [],
      budget_tokens: 0,
      clone_head: null,
    }));
    const projectContext = { rescan } as unknown as ProjectContextService;
    const app = await buildApp({ config, overrides: { auth: AUTH, projectContext } });

    const res = await app.inject({ method: 'POST', url: `/repos/${REPO_ID}/context/rescan` });

    expect(res.statusCode).toBe(200);
    expect(rescan).toHaveBeenCalledWith('ws-1', REPO_ID);
    await app.close();
  });

  it('rejects a path-traversal preview query with 422 before the handler runs', async () => {
    const preview = vi.fn();
    const projectContext = { preview } as unknown as ProjectContextService;
    const app = await buildApp({ config, overrides: { auth: AUTH, projectContext } });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context/documents/preview?path=${encodeURIComponent('../../etc/passwd')}`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    expect(preview).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a leading-slash preview path with 422', async () => {
    const preview = vi.fn();
    const projectContext = { preview } as unknown as ProjectContextService;
    const app = await buildApp({ config, overrides: { auth: AUTH, projectContext } });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context/documents/preview?path=${encodeURIComponent('/etc/passwd')}`,
    });

    expect(res.statusCode).toBe(422);
    expect(preview).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a cross-workspace preview attempt with 404 and never calls the service', async () => {
    const preview = vi.fn();
    const projectContext = { preview } as unknown as ProjectContextService;
    const reviewRepo = {
      getRepo: vi.fn(async () => ({ id: OTHER_REPO_ID, workspaceId: 'ws-OTHER' })),
    } as unknown as ReviewRepository;
    const app = await buildApp({ config, overrides: { auth: AUTH, projectContext, reviewRepo } });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${OTHER_REPO_ID}/context/documents/preview?path=specs/a.md`,
    });

    expect(res.statusCode).toBe(404);
    expect(preview).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a cross-workspace drift attempt (owner agent in another workspace) with 404 and never calls the service', async () => {
    const drift = vi.fn();
    const projectContext = { drift } as unknown as ProjectContextService;
    const reviewRepo = {
      getRepo: vi.fn(async () => ({ id: REPO_ID, workspaceId: 'ws-1' })),
    } as unknown as ReviewRepository;
    // Agent exists, but not in the caller's workspace — getById is
    // workspace-scoped, so it resolves to undefined here (mirrors the real
    // repository's contract).
    const agentsRepo = { getById: vi.fn(async () => undefined) } as unknown as AgentsRepository;
    const app = await buildApp({
      config,
      overrides: { auth: AUTH, projectContext, reviewRepo, agentsRepo },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context/drift?owner_kind=agent&owner_id=${AGENT_ID}&path=specs/a.md`,
    });

    expect(res.statusCode).toBe(404);
    expect(drift).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a cross-workspace confirm attempt (owner agent in another workspace) with 404 and never calls the service', async () => {
    const confirm = vi.fn();
    const projectContext = { confirm } as unknown as ProjectContextService;
    const reviewRepo = {
      getRepo: vi.fn(async () => ({ id: REPO_ID, workspaceId: 'ws-1' })),
    } as unknown as ReviewRepository;
    const agentsRepo = { getById: vi.fn(async () => undefined) } as unknown as AgentsRepository;
    const app = await buildApp({
      config,
      overrides: { auth: AUTH, projectContext, reviewRepo, agentsRepo },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/context/confirm`,
      payload: { owner_kind: 'agent', owner_id: AGENT_ID, path: 'specs/a.md' },
    });

    expect(res.statusCode).toBe(404);
    expect(confirm).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a cross-workspace skill owner on drift with 404', async () => {
    const drift = vi.fn();
    const projectContext = { drift } as unknown as ProjectContextService;
    const reviewRepo = {
      getRepo: vi.fn(async () => ({ id: REPO_ID, workspaceId: 'ws-1' })),
    } as unknown as ReviewRepository;
    const skillsRepo = { getById: vi.fn(async () => undefined) } as unknown as SkillsRepository;
    const app = await buildApp({
      config,
      overrides: { auth: AUTH, projectContext, reviewRepo, skillsRepo },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/context/drift?owner_kind=skill&owner_id=${AGENT_ID}&path=specs/a.md`,
    });

    expect(res.statusCode).toBe(404);
    expect(drift).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /agents/:id/context 404s for an agent outside the caller workspace, never calling the service', async () => {
    const effectiveContext = vi.fn();
    const projectContext = { effectiveContext } as unknown as ProjectContextService;
    const agentsRepo = { getById: vi.fn(async () => undefined) } as unknown as AgentsRepository;
    const app = await buildApp({ config, overrides: { auth: AUTH, projectContext, agentsRepo } });

    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/context` });

    expect(res.statusCode).toBe(404);
    expect(effectiveContext).not.toHaveBeenCalled();
    await app.close();
  });
});
