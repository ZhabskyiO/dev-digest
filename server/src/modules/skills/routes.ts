import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillImportRequest, SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const SkillsQuery = z.object({
  q: z.string().optional(),
  lang: z.string().optional(),
});

const SkillUsageQuery = z.object({
  agent_id: z.string().uuid(),
  days: z.coerce.number().int().positive().optional(),
});

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                       → list (workspace-scoped)
 *   GET    /skills/:id                   → one skill
 *   POST   /skills                       → create
 *   PUT    /skills/:id                   → update (body change bumps version)
 *   DELETE /skills/:id                   → delete
 *   GET    /skills/stats                 → per-skill summary rows (list rail)
 *   GET    /skills/:id/versions          → body history (newest first)
 *   GET    /skills/:id/versions/:version → one body snapshot
 *   POST   /skills/:id/versions/:version/restore → re-apply an old body (201)
 *   GET    /skills/:id/stats             → usage/accept/findings for one skill
 *   GET    /skills/:id/agents            → agents using this skill
 *   POST   /skills/import/preview        → preview an import (file/url/community); persists nothing
 *   GET    /skills/community             → curated community catalog
 *   GET    /skills/usage                 → per-agent skill usage (MOST-USED SKILLS)
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
  /** "What changed" note for the snapshot this edit creates. Ignored when the
   *  body is unchanged, because no snapshot is written then. */
  version_label: z.string().max(120).optional(),
});

const StatsQuery = z.object({
  days: z.coerce.number().int().positive().optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // MUST be declared before `/skills/:id` — Fastify would otherwise match
  // "stats" as an id and reject it against the uuid schema with a 422.
  app.get('/skills/stats', { schema: { querystring: StatsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.statsSummaries(workspaceId, req.query.days);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      body: body.body,
      source: body.source ?? 'manual',
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { version_label, ...rest } = req.body;
      const skill = await service.update(workspaceId, req.params.id, {
        ...rest,
        ...(version_label !== undefined ? { versionLabel: version_label } : {}),
      });
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill version not found');
      reply.status(201);
      return skill;
    },
  );

  app.get(
    '/skills/:id/stats',
    { schema: { params: IdParams, querystring: StatsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.stats(workspaceId, req.params.id, req.query.days);
      if (!stats) throw new NotFoundError('Skill not found');
      return stats;
    },
  );

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agents = await service.agentsUsing(workspaceId, req.params.id);
    if (!agents) throw new NotFoundError('Skill not found');
    return agents;
  });

  app.post(
    '/skills/import/preview',
    { schema: { body: SkillImportRequest }, bodyLimit: 8 * 1024 * 1024 },
    async (req) => {
      await getContext(app.container, req);
      return service.importPreview(req.body);
    },
  );

  app.get('/skills/community', { schema: { querystring: SkillsQuery } }, async (req) => {
    await getContext(app.container, req);
    return service.communityCatalog(req.query.q, req.query.lang);
  });

  app.get('/skills/usage', { schema: { querystring: SkillUsageQuery } }, async (req) => {
    await getContext(app.container, req);
    return service.usage(req.query.agent_id, req.query.days ?? 30);
  });
}
