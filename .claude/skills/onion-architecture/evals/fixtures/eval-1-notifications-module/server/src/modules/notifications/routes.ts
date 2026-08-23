import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, count, eq, isNull } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { NotificationsService } from './service.js';

/** `/notifications?kind=&limit=` — optional filters for the bell dropdown. */
const ListQuery = z.object({
  kind: z.enum(['review_done', 'review_failed', 'mention']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const NotificationDto = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  pull_url: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});

/**
 * N1 — notifications module (owner N1).
 *   GET    /notifications            → list (workspace-scoped)
 *   GET    /notifications/unread     → unread badge count
 *   POST   /notifications/:id/read   → mark one read
 *   DELETE /notifications/:id        → dismiss
 */
export async function notificationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const service = new NotificationsService(app.container);

  r.get(
    '/notifications',
    { schema: { querystring: ListQuery, response: { 200: z.array(NotificationDto) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.query);
    },
  );

  r.get(
    '/notifications/unread',
    { schema: { response: { 200: z.object({ count: z.number().int() }) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const [row] = await app.container.db
        .select({ value: count() })
        .from(t.notifications)
        .where(
          and(eq(t.notifications.workspaceId, workspaceId), isNull(t.notifications.readAt)),
        );
      return { count: row?.value ?? 0 };
    },
  );

  r.post(
    '/notifications/:id/read',
    { schema: { params: IdParams, response: { 200: NotificationDto } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.markRead(workspaceId, req.params.id);
      if (!updated) throw new NotFoundError('notification', req.params.id);
      return updated;
    },
  );

  r.delete(
    '/notifications/:id',
    { schema: { params: IdParams, response: { 204: z.null() } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.dismiss(workspaceId, req.params.id);
      return reply.code(204).send();
    },
  );
}
