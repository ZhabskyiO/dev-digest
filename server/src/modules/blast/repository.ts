import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { MAX_PRIOR_PRS } from './constants.js';

/**
 * Blast data-access. Owns nothing — it only joins `pr_files` against
 * `pull_requests` to answer "who else has been in these files lately?".
 *
 * The symbol/caller/endpoint side of the feature never touches Drizzle here:
 * it goes through the `RepoIntel` facade, which owns the index tables.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * Prior PRs in the same repo that touched at least one of `paths`.
   *
   * Workspace scoping comes from the caller having already resolved this PR
   * inside its workspace; `repoId` is taken off that row, and a repo belongs to
   * exactly one workspace — so filtering on repoId is equivalent here and keeps
   * the join to two tables.
   */
  async priorPrsTouching(
    repoId: string,
    excludePrId: string,
    paths: string[],
  ): Promise<
    {
      id: string;
      number: number;
      title: string;
      author: string | null;
      updatedAt: Date | null;
      overlappingFiles: number;
    }[]
  > {
    if (paths.length === 0) return [];
    const rows = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
        updatedAt: t.pullRequests.updatedAt,
        overlappingFiles: count(sql`distinct ${t.prFiles.path}`),
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.prFiles.prId))
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          inArray(t.prFiles.path, paths),
        ),
      )
      .groupBy(
        t.pullRequests.id,
        t.pullRequests.number,
        t.pullRequests.title,
        t.pullRequests.author,
        t.pullRequests.updatedAt,
      )
      .orderBy(desc(t.pullRequests.updatedAt), desc(t.pullRequests.number))
      .limit(MAX_PRIOR_PRS);

    return rows;
  }
}
