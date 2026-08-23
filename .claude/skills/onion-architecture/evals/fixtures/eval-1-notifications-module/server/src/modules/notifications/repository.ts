import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { NotificationKind } from '@devdigest/shared';
import type { NotificationRow } from '../../db/rows.js';

export type { NotificationRow };

/**
 * N1 — notifications data-access. Owns the `notifications` table. Every query is
 * workspace-scoped; rows are returned as domain rows, never as query builders.
 */

export interface InsertNotification {
  workspaceId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  pullUrl?: string | null;
}

export interface ListOptions {
  kind?: NotificationKind;
  limit: number;
}

export class NotificationsRepository {
  constructor(private readonly db: Db) {}

  async list(workspaceId: string, opts: ListOptions): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(t.notifications)
      .where(
        opts.kind
          ? and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.kind, opts.kind))
          : eq(t.notifications.workspaceId, workspaceId),
      )
      .orderBy(desc(t.notifications.createdAt))
      .limit(opts.limit);
  }

  async unreadCount(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(t.notifications)
      .where(and(eq(t.notifications.workspaceId, workspaceId), isNull(t.notifications.readAt)));
    return row?.value ?? 0;
  }

  async insert(input: InsertNotification): Promise<NotificationRow> {
    const [row] = await this.db
      .insert(t.notifications)
      .values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        pullUrl: input.pullUrl ?? null,
      })
      .returning();
    return row;
  }

  async markRead(workspaceId: string, id: string): Promise<NotificationRow | undefined> {
    const [row] = await this.db
      .update(t.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, id)))
      .returning();
    return row;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    await this.db
      .delete(t.notifications)
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, id)));
  }
}
