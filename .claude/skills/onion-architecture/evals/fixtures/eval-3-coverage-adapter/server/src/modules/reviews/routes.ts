import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { CodecovAdapter } from '../../adapters/coverage/codecov.js';
import { ReviewsService } from './service.js';

const CoverageQuery = z.object({
  base_sha: z.string().length(40),
  head_sha: z.string().length(40),
});

const CoverageDto = z.object({
  base_coverage: z.number(),
  head_coverage: z.number(),
  delta: z.number(),
  regressed: z.boolean(),
  worst_files: z.array(z.object({ path: z.string(), coverage: z.number() })),
});

/**
 * R3 — reviews module, coverage endpoints.
 *   GET /reviews/:id/coverage → base vs head coverage for the reviewed PR
 */
export async function reviewCoverageRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const service = new ReviewsService(app.container);

  r.get(
    '/reviews/:id/coverage',
    {
      schema: {
        params: IdParams,
        querystring: CoverageQuery,
        response: { 200: CoverageDto },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const review = await service.get(workspaceId, req.params.id);
      if (!review) throw new NotFoundError('review', req.params.id);

      const token = await app.container.secrets.get('CODECOV_TOKEN');
      const codecov = new CodecovAdapter(token);

      const [base, head] = await Promise.all([
        codecov.codecovFetchReport('github', review.repoOwner, review.repoName, req.query.base_sha),
        codecov.codecovFetchReport('github', review.repoOwner, review.repoName, req.query.head_sha),
      ]);

      return {
        base_coverage: base.totals.coverage,
        head_coverage: head.totals.coverage,
        delta: Number((head.totals.coverage - base.totals.coverage).toFixed(2)),
        regressed: codecov.isRegression(base, head),
        worst_files: head.files
          .sort((a, b) => a.totals.coverage - b.totals.coverage)
          .slice(0, 5)
          .map((f) => ({ path: f.name, coverage: f.totals.coverage })),
      };
    },
  );
}
