import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CreateEvalCaseBody, UpdateEvalCaseBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalsService } from './service.js';

/**
 * L07 — eval pipeline module.
 *   GET    /findings/:id/eval-case-seed → prefill payload for the case editor
 *   POST   /findings/:id/eval-case   → one-click case from a real finding
 *                                      (accepted → must_find, dismissed → must_not_flag)
 *   GET    /agents/:id/eval-cases    → the agent's case set
 *   POST   /agents/:id/eval-cases    → manual case authoring
 *   PUT    /eval-cases/:id           → edit a case (case-editor modal)
 *   POST   /eval-cases/:id/run       → run ONE case (play button; scope:'case')
 *   DELETE /eval-cases/:id           → remove a case (cascades its runs)
 *   POST   /agents/:id/eval-runs     → run the agent over ALL cases; code-only scoring
 *   GET    /agents/:id/eval-runs     → batch history (newest first) for compare
 *   GET    /evals/dashboard          → latest batches across all agents
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalsService(app.container);

  app.get('/findings/:id/eval-case-seed', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.seedFromFinding(workspaceId, req.params.id);
  });

  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.createFromFinding(workspaceId, req.params.id);
    if (result.created) reply.status(201);
    return result;
  });

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await service.listCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Agent not found');
    return cases;
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createManual(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.post('/eval-cases/:id/run', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.runSingleCase(workspaceId, req.params.id, req.log);
    reply.status(201);
    return result;
  });

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.run(workspaceId, req.params.id, req.log);
    reply.status(201);
    return result;
  });

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const batches = await service.history(workspaceId, req.params.id);
    if (!batches) throw new NotFoundError('Agent not found');
    return batches;
  });

  // ---- skill-owned eval sets ---------------------------------------------
  app.get('/skills/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await service.listSkillCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Skill not found');
    return cases;
  });

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createSkillManual(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Skill not found');
      reply.status(201);
      return created;
    },
  );

  app.post('/skills/:id/eval-runs', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.runSkill(workspaceId, req.params.id, req.log);
    reply.status(201);
    return result;
  });

  app.get('/skills/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const batches = await service.skillHistory(workspaceId, req.params.id);
    if (!batches) throw new NotFoundError('Skill not found');
    return batches;
  });

  app.get('/evals/dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });
}
