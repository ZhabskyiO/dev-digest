import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EffectiveProjectContext,
  ProjectContextAttachment,
  ProjectContextDrift,
  ProjectContextListResponse,
  ProjectContextPreview,
  ProjectContextRef,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';

/**
 * T11 — project-context routes. Transport layer only: parses/validates
 * requests via `fastify-type-provider-zod`, resolves tenancy through
 * `getContext`, and delegates to `container.projectContext`
 * (`ProjectContextService`, T9) for every business decision. See
 * specs/2026-08-18-project-context.md.
 *
 *   GET    /repos/:id/context/documents                       → discovery list (AC-1..AC-8, AC-43)
 *   POST   /repos/:id/context/rescan                          → re-walk the clone (AC-6), rate-limited
 *   GET    /repos/:id/context/documents/preview               → markdown body, capped (AC-10, AC-11)
 *   GET    /repos/:id/context/drift                            → drift detail for one attachment (AC-38)
 *   POST   /repos/:id/context/confirm                          → clear a drift marker (AC-37)
 *   GET    /agents/:id/context                                 → agent's effective context set (AC-16, AC-17, AC-40)
 *   PUT    /agents/:id/context                                 → replace agent's own attachment set (AC-12, AC-14, AC-19)
 *   GET    /skills/:id/context                                 → skill's own ordered attachment list (AC-13),
 *                                                                  via `ProjectContextService.skillContext`
 *
 * SECURITY: `ProjectContextService.preview` takes no `workspaceId` (unlike
 * `list`/`rescan`, which resolve it through `getWorkspaceRepo` internally) —
 * so this file is where cross-tenant access is closed for preview, drift,
 * and confirm: every one of those handlers verifies the target repo belongs
 * to the caller's workspace, and drift/confirm additionally verify the
 * `owner_id` (agent or skill) does too, BEFORE calling the service.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // A clone-relative document path is attacker-influenced (it arrives as a
  // query param / body field, and drives filesystem reads downstream). This
  // is defence-in-depth #1: reject the obviously-hostile shapes at the
  // schema layer so they never reach a handler. The service's own
  // `resolveInClone` (realpath + prefix check) is defence-in-depth #2 for
  // whatever slips past a merely-textual check (e.g. a symlink).
  const ContextPath = z
    .string()
    .min(1)
    .refine((p) => !p.startsWith('/'), 'path must not start with "/"')
    .refine((p) => !p.split('/').includes('..'), 'path must not contain ".."');

  const OwnerKind = z.enum(['agent', 'skill']);

  const PreviewQuery = z.object({ path: ContextPath });
  const DriftQuery = z.object({
    owner_kind: OwnerKind,
    owner_id: z.string().uuid(),
    path: ContextPath,
  });
  const ConfirmBody = z.object({
    owner_kind: OwnerKind,
    owner_id: z.string().uuid(),
    path: ContextPath,
  });
  const SetAgentContextBody = z.object({ documents: z.array(ProjectContextRef) });
  const ConfirmResponse = z.object({ ok: z.boolean() });
  const SkillContextResponse = z.array(ProjectContextAttachment);

  /** Throws `NotFoundError` unless `repoId` resolves to a repo owned by
   *  `workspaceId` — the workspace check `ProjectContextService.preview` /
   *  `.drift` / `.confirm` don't perform themselves (see file header). */
  async function assertRepoInWorkspace(
    container: Container,
    workspaceId: string,
    repoId: string,
  ): Promise<void> {
    const repo = await container.reviewRepo.getRepo(repoId);
    if (!repo || repo.workspaceId !== workspaceId) throw new NotFoundError('Repository not found');
  }

  /** Resolves `(owner_kind, owner_id)` into the service's `AttachmentOwnerRef`
   *  shape, throwing `NotFoundError` unless the referenced agent/skill
   *  belongs to `workspaceId`. */
  async function resolveOwner(
    container: Container,
    workspaceId: string,
    ownerKind: z.infer<typeof OwnerKind>,
    ownerId: string,
  ): Promise<{ agentId: string } | { skillId: string }> {
    if (ownerKind === 'agent') {
      const agent = await container.agentsRepo.getById(workspaceId, ownerId);
      if (!agent) throw new NotFoundError('Agent not found');
      return { agentId: ownerId };
    }
    const skill = await container.skillsRepo.getById(workspaceId, ownerId);
    if (!skill) throw new NotFoundError('Skill not found');
    return { skillId: ownerId };
  }

  /** Every `repo_id` a PUT /agents/:id/context body references must also
   *  belong to the caller's workspace — otherwise an agent in workspace A
   *  could attach a document read out of workspace B's repo clone. */
  async function assertRefsInWorkspace(
    container: Container,
    workspaceId: string,
    refs: readonly { repo_id: string }[],
  ): Promise<void> {
    const repoIds = [...new Set(refs.map((r) => r.repo_id))];
    for (const repoId of repoIds) {
      await assertRepoInWorkspace(container, workspaceId, repoId);
    }
  }

  // ---- Repo-level document surface ---------------------------------------

  app.get(
    '/repos/:id/context/documents',
    { schema: { params: IdParams, response: { 200: ProjectContextListResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.list(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/context/rescan',
    {
      schema: { params: IdParams, response: { 200: ProjectContextListResponse } },
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.rescan(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/documents/preview',
    {
      schema: { params: IdParams, querystring: PreviewQuery, response: { 200: ProjectContextPreview } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await assertRepoInWorkspace(app.container, workspaceId, req.params.id);
      return app.container.projectContext.preview(req.params.id, req.query.path);
    },
  );

  app.get(
    '/repos/:id/context/drift',
    { schema: { params: IdParams, querystring: DriftQuery, response: { 200: ProjectContextDrift } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await assertRepoInWorkspace(app.container, workspaceId, req.params.id);
      const owner = await resolveOwner(
        app.container,
        workspaceId,
        req.query.owner_kind,
        req.query.owner_id,
      );
      return app.container.projectContext.drift(owner, req.params.id, req.query.path);
    },
  );

  app.post(
    '/repos/:id/context/confirm',
    { schema: { params: IdParams, body: ConfirmBody, response: { 200: ConfirmResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await assertRepoInWorkspace(app.container, workspaceId, req.params.id);
      const owner = await resolveOwner(
        app.container,
        workspaceId,
        req.body.owner_kind,
        req.body.owner_id,
      );
      await app.container.projectContext.confirm(owner, req.params.id, req.body.path);
      return { ok: true };
    },
  );

  // ---- Agent attachment surface ------------------------------------------

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, response: { 200: EffectiveProjectContext } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
      if (!agent) throw new NotFoundError('Agent not found');
      return app.container.projectContext.effectiveContext(req.params.id);
    },
  );

  app.put(
    '/agents/:id/context',
    {
      schema: {
        params: IdParams,
        body: SetAgentContextBody,
        response: { 200: EffectiveProjectContext },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
      if (!agent) throw new NotFoundError('Agent not found');
      await assertRefsInWorkspace(app.container, workspaceId, req.body.documents);
      await app.container.projectContext.setAgentContext(workspaceId, req.params.id, req.body.documents);
      return app.container.projectContext.effectiveContext(req.params.id);
    },
  );

  // ---- Skill attachment surface (read side) ------------------------------

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, response: { 200: SkillContextResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await app.container.skillsRepo.getById(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return app.container.projectContext.skillContext(req.params.id);
    },
  );
}
