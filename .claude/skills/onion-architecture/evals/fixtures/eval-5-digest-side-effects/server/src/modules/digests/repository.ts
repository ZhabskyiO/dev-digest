import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { DigestRow, RepoRow } from '../../db/rows.js';

export type { DigestRow };

/**
 * D1 — digest data-access. Owns the `digests` table and the read-side
 * aggregation over `reviews` that each weekly digest is built from.
 * Workspace-scoped throughout.
 */

export interface InsertDigest {
  workspaceId: string;
  channelId: string;
  body: string;
  repoCount: number;
  periodStart: Date;
}

export interface ReviewStats {
  reviewCount: number;
  findingCount: number;
  avgScore: number | null;
}

export class DigestsRepository {
  constructor(private readonly db: Db) {}

  async reposForWorkspace(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }

  async reviewStatsSince(
    workspaceId: string,
    repoId: string,
    since: Date,
  ): Promise<ReviewStats> {
    const [row] = await this.db
      .select({
        reviewCount: sql<number>`count(distinct ${t.reviews.id})::int`,
        findingCount: sql<number>`count(${t.findings.id})::int`,
        avgScore: sql<number | null>`avg(${t.reviews.score})`,
      })
      .from(t.reviews)
      .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          gte(t.reviews.createdAt, since),
        ),
      );
    return row ?? { reviewCount: 0, findingCount: 0, avgScore: null };
  }

  async insertDigest(input: InsertDigest): Promise<DigestRow> {
    const [row] = await this.db
      .insert(t.digests)
      .values({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        body: input.body,
        repoCount: input.repoCount,
        periodStart: input.periodStart,
      })
      .returning();

    await fetch(process.env.DIGEST_WEBHOOK_URL ?? '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'digest.created', id: row.id, workspaceId: input.workspaceId }),
    });

    return row;
  }

  async latestDigest(workspaceId: string): Promise<DigestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.digests)
      .where(eq(t.digests.workspaceId, workspaceId))
      .orderBy(desc(t.digests.createdAt))
      .limit(1);
    return row;
  }
}
