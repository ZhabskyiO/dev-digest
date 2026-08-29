import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  MultiAgentRun,
  MultiAgentRunRequest,
  MultiAgentRunStartResponse,
  PrAgentEstimates,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RUN_TRIGGER_RATE_LIMIT } from '../_shared/rate-limits.js';
import { MultiAgentService } from './service.js';

/**
 * multi-agent module (L07).
 *   POST /pulls/:id/multi-agent-run   {agent_ids}  → start a multi-agent run; returns immediately
 *   GET  /pulls/:id/multi-agent                    → latest multi-agent run (columns + conflicts), or null
 *   GET  /pulls/:id/agent-estimates                → per-agent pre-run duration/cost estimate
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  // Same fence as the single-agent trigger (`POST /pulls/:id/review`) — each
  // call can fan out to several concurrent LLM runs. `RUN_TRIGGER_RATE_LIMIT`
  // is shared with that route so the two triggers can't drift (Rec-6).
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: {
        params: IdParams,
        body: MultiAgentRunRequest,
        response: { 200: MultiAgentRunStartResponse },
      },
      config: { rateLimit: RUN_TRIGGER_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.start(workspaceId, req.params.id, req.body.agent_ids, req.log);
    },
  );

  // 200 + `null` (never 404): "no multi-agent run yet" is the normal state
  // for any PR that has never had one — same taxonomy as the PR intent/brief
  // GETs elsewhere in this module set.
  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams, response: { 200: MultiAgentRun.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.latest(workspaceId, req.params.id);
    },
  );

  app.get(
    '/pulls/:id/agent-estimates',
    { schema: { params: IdParams, response: { 200: PrAgentEstimates } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.estimates(workspaceId, req.params.id);
    },
  );
}
