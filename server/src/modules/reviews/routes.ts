import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  RunRequest,
  PrIntentDetail,
  SmartDiff,
  LocalReviewRequest,
  LocalReviewResult,
} from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { LocalReviewService } from './local-review.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   GET    /pulls/:id/intent                           → the derived PR intent (L03), or null
 *   POST   /pulls/:id/intent/recalculate               → force a fresh derivation (spends tokens)
 *   GET    /pulls/:id/smart-diff                       → reviewer-ordered files (deterministic, no LLM)
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const localReviews = new LocalReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Review a LOCAL diff (no PR) ---------------------------------------
  // The pre-push path: `devdigest review --mode working` posts the working
  // tree's `git diff HEAD` and gets the same grounded findings a PR review
  // returns. Synchronous by design — the caller is a CLI that must exit with a
  // verdict, not a UI that can subscribe to a run — so there is no run id, no
  // SSE stream, and nothing persisted (see LocalReviewService).
  //
  // Same 10/min limit as /pulls/:id/review: one call, one LLM review.
  app.post(
    '/reviews/local',
    {
      schema: { body: LocalReviewRequest, response: { 200: LocalReviewResult } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return localReviews.review(workspaceId, req.body, req.log);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Derived PR intent (L03) -------------------------------------------
  // 200 + `null` (never 404): "no intent yet" is the normal state for any PR
  // never reviewed, and a 404 would route through the client's full-screen
  // ApiError taxonomy for what is an ordinary empty state.
  //
  // The AUTOMATIC trigger is still lazy-inside-the-run and only that (see
  // IntentService.deriveForRun) — nothing polls, nothing derives on read. The
  // manual POST below is the one exception, and it is fenced accordingly.
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentDetail.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // Workspace-scoped: `pr_intent` has no workspace_id of its own, so this
      // MUST go through the join in getIntentDetail (via the service) — a
      // bare pr_id lookup would be a cross-workspace read.
      const detail = await service.getIntentDetail(workspaceId, req.params.id);
      return detail ?? null;
    },
  );

  // ---- Force a fresh derivation (the ONE manual trigger) ------------------
  // This is the only route in the module that spends tokens without a run
  // behind it, so it carries its own fences: a rate limit stricter than
  // /pulls/:id/review (3/min vs 10/min — there is no per-agent fan-out to
  // amortise the call over) on top of IntentService.recalculate's per-PR
  // in-flight dedupe, which is what actually stops a double-click from buying
  // two model calls.
  //
  // Non-nullable response by design: unlike the GET, "nothing came back" here
  // means the derivation failed, and the service raises a 502 rather than
  // answering 200 with the stale row.
  app.post(
    '/pulls/:id/intent/recalculate',
    {
      schema: { params: IdParams, response: { 200: PrIntentDetail } },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.recalculateIntent(workspaceId, req.params.id, req.log);
    },
  );

  // ---- Smart Diff (reviewer-ordered files) --------------------------------
  // Deterministic and LLM-free: classification runs off the already-imported
  // `pr_files` rows, so it answers for a PR that has never been reviewed (every
  // `finding_lines` is simply empty). No POST and nothing persisted — the
  // result is a pure function of two tables and is cheaper to recompute than
  // to cache or invalidate.
  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiff } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.smartDiffForPull(workspaceId, req.params.id);
    },
  );

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
