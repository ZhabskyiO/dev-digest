/**
 * T13 — CI route smoke tests. No DB: `MockAuthProvider` fixes the caller's
 * workspace/user so `getContext` never touches `LocalNoAuthProvider`'s
 * DB-backed lookups. `target: 'jenkins'` is enough to prove the 4xx path
 * (AC-12) with NO other override — `CiService.exportToCi` calls
 * `assertSupportedTarget` as its very first, synchronous statement, before
 * any agent lookup or DB/GitHub call, so this never touches the real
 * container's `db`/`github()`.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider } from '../../adapters/mocks.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AUTH = new MockAuthProvider(
  { id: 'u1', email: 'you@local', name: 'You' },
  { id: 'ws-1', name: 'default' },
);

const AGENT_ID = '11111111-1111-1111-1111-111111111111';

describe('ci routes (no DB)', () => {
  it('POST /agents/:id/export-ci with target "jenkins" returns 4xx (AC-12)', async () => {
    const app = await buildApp({ config, overrides: { auth: AUTH } });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/export-ci`,
      payload: { repo: 'acme/widgets', target: 'jenkins' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json().error.code).toBe('validation_error');

    await app.close();
  });

  it('POST /agents/:id/export-ci rejects a malformed :id with 422 before the handler runs', async () => {
    const app = await buildApp({ config, overrides: { auth: AUTH } });

    const res = await app.inject({
      method: 'POST',
      url: '/agents/not-a-uuid/export-ci',
      payload: { repo: 'acme/widgets' },
    });

    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('GET /ci-runs?offset=-1 rejects with 422 before the handler (and any DB call) runs', async () => {
    const app = await buildApp({ config, overrides: { auth: AUTH } });

    const res = await app.inject({ method: 'GET', url: '/ci-runs?offset=-1' });

    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('GET /ci-runs?limit=100000000 rejects with 422 (unbounded fetch guard)', async () => {
    const app = await buildApp({ config, overrides: { auth: AUTH } });

    const res = await app.inject({ method: 'GET', url: '/ci-runs?limit=100000000' });

    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('POST /ci-runs/refresh accepts a literal null JSON body (curl -d null) as well as no body', async () => {
    const app = await buildApp({ config, overrides: { auth: AUTH } });

    const nullBody = await app.inject({
      method: 'POST',
      url: '/ci-runs/refresh',
      headers: { 'content-type': 'application/json' },
      payload: 'null',
    });
    expect(nullBody.statusCode).not.toBe(422);

    const noBody = await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(noBody.statusCode).not.toBe(422);

    await app.close();
  });
});
