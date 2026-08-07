import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionStatus,
  CreateSkillFromConventionsRequest,
  UpdateConventionRequest,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module — extract house-rules from a repo, review them, fold the
 * good ones into a skill.
 *
 *   POST /repos/:id/conventions/extract → scan + verify + persist (synchronous)
 *   GET  /repos/:id/conventions         → candidates (?status= filter)
 *   PATCH /conventions/:id              → approve / reject / edit
 *   POST /repos/:id/conventions/skill   → create a skill from chosen candidates
 *
 * `extract` runs inline rather than through the JobRunner: it is a single model
 * call the user explicitly asked for and waits on, so a 202 + poll would only
 * add a state machine without changing what the user sees.
 */

const ConventionsQuery = z.object({ status: ConventionStatus.optional() });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(container);

  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams, querystring: ConventionsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.list(workspaceId, req.params.id, req.query.status);
    },
  );

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionRequest } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateSkillFromConventionsRequest } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.createSkill(workspaceId, req.params.id, req.body);
      reply.status(201);
      return result;
    },
  );
}
