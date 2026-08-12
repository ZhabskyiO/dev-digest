import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast module — "what else can this diff touch?"
 *
 *   GET /pulls/:id/blast → BlastRadiusResult
 *
 * Serves the symbols declared in the PR's changed files, who calls them, and
 * the HTTP endpoints / cron jobs reachable downstream, straight out of the
 * repo-intel index. Always 200 for a PR that exists: an unusable index comes
 * back as `status: 'degraded'` with a reason, because "we don't know" and
 * "nothing is affected" must not look the same to a reviewer.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.blastForPull(workspaceId, req.params.id);
    },
  );
}
