/**
 * Onboarding HTTP module (T12) — the transport layer over T10's
 * `OnboardingService`.
 *
 *   GET  /repos/:id/onboarding           → OnboardingTourResponse (AC-6,7,11,
 *                                           24,25,29,30,41,48,52 — zero model
 *                                           calls, see service.ts)
 *   POST /repos/:id/onboarding/generate  → 202 OnboardingGenerateResponse
 *                                           (AC-26, AC-27, AC-28, AC-31)
 *
 * Job-handler registration lives here: this plugin runs once at app boot and
 * calls `container.onboarding.registerJobHandlers()` so the
 * `onboarding.generate` job enqueued by `requestGeneration` has a handler to
 * run against, against the exact same `OnboardingService` instance the route
 * handlers below resolve through `container.onboarding` — see the comment on
 * that call for why this deliberately does NOT mirror
 * `repo-intel/routes.ts`'s `new RepoIntelService(container)` precedent.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingTourResponse, OnboardingGenerateResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';

/**
 * Throws `NotFoundError` unless `repoId` resolves to a repo owned by
 * `workspaceId`. `OnboardingService.getTour`/`requestGeneration` are NOT
 * workspace-scoped themselves (see `service.ts`'s doc comment on `getTour`) —
 * this is the tenancy check both handlers below rely on, before either reads
 * or spends model budget on another workspace's repo. Copies
 * `project-context/routes.ts`'s `assertRepoInWorkspace` precedent exactly:
 * `NotFoundError` (not 403) so the endpoint does not disclose whether a repo
 * id exists in another workspace.
 */
async function assertRepoInWorkspace(
  container: Container,
  workspaceId: string,
  repoId: string,
): Promise<void> {
  const repo = await container.reviewRepo.getRepo(repoId);
  if (!repo || repo.workspaceId !== workspaceId) throw new NotFoundError('Repository not found');
}

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  // Register the onboarding.generate handler exactly once at module load,
  // against the SAME instance `container.onboarding` hands the route
  // handlers below (the lazy getter memoises it — see container.ts). This
  // is a deliberate divergence from `repo-intel/routes.ts`'s
  // `new RepoIntelService(container)` precedent: unlike repo-intel,
  // onboarding is exercised by `ContainerOverrides.onboarding` test doubles
  // (see `test/onboarding-routes.test.ts`), and a locally-constructed
  // service here would register the job handler against the real
  // `OnboardingService` while a test's override controls only the route
  // handlers — silently decoupling what a test asserts from what actually
  // runs the job. Do not "fix" this back to match repo-intel.
  container.onboarding.registerJobHandlers();

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await assertRepoInWorkspace(container, workspaceId, req.params.id);
      return container.onboarding.getTour(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      schema: { params: IdParams, response: { 202: OnboardingGenerateResponse } },
      // Defence in depth only — `app.inject()` skips @fastify/rate-limit in
      // test mode (app.ts:95, server insight 2026-08-09), so this is never
      // the correctness fence. The real fence is the service's in-flight
      // dedupe (AC-27).
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      await assertRepoInWorkspace(container, workspaceId, req.params.id);
      reply.code(202);
      // Unlike resync's POST /repos/:id/resync (repo-intel/routes.ts:43-65),
      // whose response carries no zod `response` schema and so can degrade
      // to an untyped `{status:'accepted', degraded:true, ...}` shape when
      // its own inline `jobs.enqueue` call fails, `OnboardingGenerateResponse`
      // is a strict `{state: 'generating', job: {id: string}}` literal with
      // no degraded variant, and the enqueue call lives inside
      // `OnboardingService.requestGeneration` (T10), not here. There is
      // therefore no honest job id to fabricate on an enqueue failure — the
      // handler is always registered at module load above, so the one
      // realistic failure mode (a DB hiccup on the `jobs` insert) is a
      // genuine error surfaced as-is rather than masked behind a fake 202.
      return container.onboarding.requestGeneration(workspaceId, req.params.id);
    },
  );
}
