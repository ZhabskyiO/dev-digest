/**
 * T12 — onboarding route smoke tests. No DB: `container.onboarding` is
 * injected via `ContainerOverrides.onboarding`, mirroring
 * `project-context-routes.test.ts`'s pattern. `MockAuthProvider` fixes the
 * caller's workspace to `'ws-1'` so `getTour`/`requestGeneration` calls can
 * be asserted deterministically.
 *
 * The route-level `rateLimit` config is NOT asserted behaviourally here —
 * `app.inject()` skips `@fastify/rate-limit` in test mode (app.ts:95, server
 * insight 2026-08-09) — its `max: 3` value is checked by a plain grep in the
 * plan's acceptance instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import type { OnboardingService } from '../src/modules/onboarding/service.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { OnboardingTourResponse, OnboardingGenerateResponse } from '@devdigest/shared';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AUTH = new MockAuthProvider(
  { id: 'u1', email: 'you@local', name: 'You' },
  { id: 'ws-1', name: 'default' },
);

const REPO_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_WORKSPACE_REPO_ID = '22222222-2222-2222-2222-222222222222';

/** A fake `ReviewRepository` whose `getRepo` reports `REPO_ID` as owned by
 *  `ws-1` (the caller's workspace, per `AUTH` above) and
 *  `OTHER_WORKSPACE_REPO_ID` as owned by a different workspace — enough to
 *  drive `assertRepoInWorkspace`'s ownership check without a DB. */
function makeReviewRepo(): ReviewRepository {
  const getRepo = vi.fn(async (id: string) => {
    if (id === REPO_ID) return { id: REPO_ID, workspaceId: 'ws-1', fullName: 'acme/widgets', clonePath: null };
    if (id === OTHER_WORKSPACE_REPO_ID) {
      return { id: OTHER_WORKSPACE_REPO_ID, workspaceId: 'ws-other', fullName: 'other/repo', clonePath: null };
    }
    return null;
  });
  return { getRepo } as unknown as ReviewRepository;
}

describe('onboarding routes (no DB)', () => {
  it('GET /repos/:id/onboarding returns 200 with state: "not_indexed" for an unindexed repo with no stored tour (AC-6)', async () => {
    const response: OnboardingTourResponse = {
      tour: null,
      state: 'not_indexed',
      stale: false,
      failure_reason: null,
      job_id: null,
    };
    const getTour = vi.fn(async () => response);
    const onboarding = { getTour, registerJobHandlers: vi.fn() } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding, reviewRepo: makeReviewRepo() } });

    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tour: null, state: 'not_indexed' });
    expect(getTour).toHaveBeenCalledWith('ws-1', REPO_ID);
    await app.close();
  });

  it('POST /repos/:id/onboarding/generate returns 202 with a job.id, and a second immediate POST returns the same id (AC-26, AC-27)', async () => {
    const generateResponse: OnboardingGenerateResponse = {
      state: 'generating',
      job: { id: 'job-1' },
    };
    const requestGeneration = vi.fn(async () => generateResponse);
    const onboarding = { requestGeneration, registerJobHandlers: vi.fn() } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding, reviewRepo: makeReviewRepo() } });

    const first = await app.inject({ method: 'POST', url: `/repos/${REPO_ID}/onboarding/generate` });
    const second = await app.inject({ method: 'POST', url: `/repos/${REPO_ID}/onboarding/generate` });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ state: 'generating', job: { id: 'job-1' } });
    expect(second.json()).toMatchObject({ state: 'generating', job: { id: 'job-1' } });
    expect(first.json().job.id).toBe(second.json().job.id);
    expect(requestGeneration).toHaveBeenCalledTimes(2);
    expect(requestGeneration).toHaveBeenCalledWith('ws-1', REPO_ID);
    await app.close();
  });

  it('rejects a malformed :id with 422 before the handler runs', async () => {
    const getTour = vi.fn();
    const requestGeneration = vi.fn();
    const onboarding = { getTour, requestGeneration, registerJobHandlers: vi.fn() } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding } });

    const getRes = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/onboarding' });
    const postRes = await app.inject({ method: 'POST', url: '/repos/not-a-uuid/onboarding/generate' });

    expect(getRes.statusCode).toBe(422);
    expect(postRes.statusCode).toBe(422);
    expect(getTour).not.toHaveBeenCalled();
    expect(requestGeneration).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /repos/:id/onboarding returns 404 for a repo belonging to a different workspace and calls no service read (tenancy)', async () => {
    const getTour = vi.fn();
    const onboarding = { getTour, registerJobHandlers: vi.fn() } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding, reviewRepo: makeReviewRepo() } });

    const res = await app.inject({ method: 'GET', url: `/repos/${OTHER_WORKSPACE_REPO_ID}/onboarding` });

    expect(res.statusCode).toBe(404);
    expect(getTour).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /repos/:id/onboarding/generate returns 404 for a repo belonging to a different workspace and enqueues nothing (tenancy)', async () => {
    const requestGeneration = vi.fn();
    const onboarding = { requestGeneration, registerJobHandlers: vi.fn() } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding, reviewRepo: makeReviewRepo() } });

    const res = await app.inject({ method: 'POST', url: `/repos/${OTHER_WORKSPACE_REPO_ID}/onboarding/generate` });

    expect(res.statusCode).toBe(404);
    expect(requestGeneration).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /repos/:id/onboarding returns 404 for a repo id that does not exist at all (tenancy guard doubles as existence check)', async () => {
    const getTour = vi.fn();
    const onboarding = { getTour, registerJobHandlers: vi.fn() } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding, reviewRepo: makeReviewRepo() } });

    const missingId = '33333333-3333-3333-3333-333333333333';
    const res = await app.inject({ method: 'GET', url: `/repos/${missingId}/onboarding` });

    expect(res.statusCode).toBe(404);
    expect(getTour).not.toHaveBeenCalled();
    await app.close();
  });

  it('registers the onboarding.generate job handler against the SAME instance a ContainerOverrides.onboarding double provides to the route handlers, not a locally-constructed one (DI regression guard)', async () => {
    const getTour = vi.fn(async () => ({
      tour: null,
      state: 'not_indexed' as const,
      stale: false,
      failure_reason: null,
      job_id: null,
    }));
    const registerJobHandlers = vi.fn();
    const onboarding = { getTour, registerJobHandlers } as unknown as OnboardingService;
    const app = await buildApp({ config, overrides: { auth: AUTH, onboarding, reviewRepo: makeReviewRepo() } });

    // `registerJobHandlers` must have been called at plugin-registration time
    // (boot), against the exact double injected via `ContainerOverrides.onboarding` —
    // proving `routes.ts` resolves the job-handler registration and the route
    // handlers below through the same `container.onboarding` getter rather
    // than constructing its own `new OnboardingService(container)`.
    expect(registerJobHandlers).toHaveBeenCalledTimes(1);

    await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });
    expect(getTour).toHaveBeenCalledWith('ws-1', REPO_ID);

    await app.close();
  });
});
