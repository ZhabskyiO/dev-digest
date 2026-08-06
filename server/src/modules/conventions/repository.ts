import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';

export type { ConventionRow };

/**
 * Convention data-access. Owns `conventions`. Reads `repos` for the clone path
 * (same shape as RepoIntelRepository.getRepoBasics) so the service never has to
 * reach into another module's data layer. Workspace-scoped throughout.
 */

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category: ConventionCategory;
  rule: string;
  ruleKey: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface UpdateConvention {
  status?: ConventionStatus;
  rule?: string;
  ruleKey?: string;
  category?: ConventionCategory;
}

export interface RepoClone {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoClone | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Candidates for a repo, newest first, optionally filtered by review status. */
  async listByRepo(
    workspaceId: string,
    repoId: string,
    status?: ConventionStatus,
  ): Promise<ConventionRow[]> {
    const conditions = [
      eq(t.conventions.workspaceId, workspaceId),
      eq(t.conventions.repoId, repoId),
    ];
    if (status) conditions.push(eq(t.conventions.status, status));
    return this.db
      .select()
      .from(t.conventions)
      .where(and(...conditions))
      .orderBy(desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async listByIds(workspaceId: string, repoId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      );
  }

  /**
   * Every rule key already stored for this repo, in ANY status. The service
   * filters new proposals against this so an accepted rule isn't duplicated and
   * a rejected one isn't resurrected.
   */
  async existingRuleKeys(repoId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ ruleKey: t.conventions.ruleKey })
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId));
    return new Set(rows.map((r) => r.ruleKey));
  }

  /**
   * Bulk-insert new candidates as `pending`. `onConflictDoNothing` on the
   * (repo_id, rule_key) unique index makes the dedupe safe against two scans
   * racing, not just against the in-memory `known` set.
   */
  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        values.map((v) => ({
          workspaceId: v.workspaceId,
          repoId: v.repoId,
          category: v.category,
          rule: v.rule,
          ruleKey: v.ruleKey,
          evidencePath: v.evidencePath,
          evidenceLine: v.evidenceLine,
          evidenceSnippet: v.evidenceSnippet,
          confidence: v.confidence,
          status: 'pending' as const,
          accepted: false,
        })),
      )
      .onConflictDoNothing()
      .returning();
  }

  /** Patch one candidate. `accepted` is kept in lockstep with `status`. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined
          ? { status: patch.status, accepted: patch.status === 'accepted' }
          : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.ruleKey !== undefined ? { ruleKey: patch.ruleKey } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Mark candidates accepted and attribute them to the skill they became. */
  async markAccepted(
    workspaceId: string,
    ids: string[],
    skillId: string,
  ): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .update(t.conventions)
      .set({ status: 'accepted', accepted: true, skillId })
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)),
      )
      .returning();
  }
}
