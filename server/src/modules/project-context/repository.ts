import { and, asc, eq, ne, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ProjectContextDocType, ProjectContextDriftOwner } from '@devdigest/shared';

/**
 * project-context data-access (T6). The ONLY file that touches
 * `project_context_documents` and `context_attachments` — every other module
 * (service, routes) reaches these tables through this repository.
 *
 * Document text is never persisted here (AC-12): rows carry a content hash /
 * size / token count, never a body.
 */

export type ProjectContextDocumentRow = typeof t.projectContextDocuments.$inferSelect;
export type ContextAttachmentRow = typeof t.contextAttachments.$inferSelect;

/** Executor type shared by plain queries and `db.transaction` callbacks —
 *  `PgTransaction` extends the same `PgDatabase` base as `Db`, so a helper
 *  written against this union works both outside and inside a transaction. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** Identifies the owner of an attachment set — exactly one of the two, mirroring
 *  the `context_attachments_target_chk` CHECK (agent XOR skill). */
export type AttachmentOwnerRef = { agentId: string } | { skillId: string };

function ownerWhere(owner: AttachmentOwnerRef) {
  return 'agentId' in owner
    ? eq(t.contextAttachments.agentId, owner.agentId)
    : eq(t.contextAttachments.skillId, owner.skillId);
}

export interface UpsertDocumentInput {
  path: string;
  type: ProjectContextDocType;
  sizeBytes: number;
  contentHash: string;
  tokens: number;
}

export interface ReplaceAttachmentInput {
  repoId: string;
  path: string;
  /** Content hash at attach time (AC-35). */
  attachedHash: string;
  /** Size in bytes at attach time (AC-35). */
  attachedSize: number;
  /** Clone commit revision at attach time (AC-35, AC-38). */
  attachedRevision: string;
}

export interface UpdateAttachedHashInput {
  attachedHash: string;
  attachedSize: number;
  attachedRevision: string;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  // ---- project_context_documents -------------------------------------------

  /**
   * Bulk upsert on `(repo_id, path)`. A conflicting row is updated only when
   * its content hash actually changed (`setWhere`) — an unmodified file's row
   * (including `scanned_at`) is left untouched, which is what lets the service
   * layer (T9) treat "hash unchanged" as "reuse the persisted token count"
   * (AC-8). A no-op on an empty `rows`.
   */
  async upsertDocuments(repoId: string, rows: UpsertDocumentInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(t.projectContextDocuments)
      .values(
        rows.map((r) => ({
          repoId,
          path: r.path,
          type: r.type,
          sizeBytes: r.sizeBytes,
          contentHash: r.contentHash,
          tokens: r.tokens,
        })),
      )
      .onConflictDoUpdate({
        target: [t.projectContextDocuments.repoId, t.projectContextDocuments.path],
        set: {
          type: sql`excluded.type`,
          sizeBytes: sql`excluded.size_bytes`,
          contentHash: sql`excluded.content_hash`,
          tokens: sql`excluded.tokens`,
          scannedAt: sql`excluded.scanned_at`,
        },
        setWhere: sql`${t.projectContextDocuments.contentHash} <> excluded.content_hash`,
      });
  }

  /**
   * Deletes every document row for `repoId` whose path is NOT in `paths` —
   * i.e. files a fresh scan no longer finds. An empty `paths` deletes every
   * row for the repo (nothing survived the scan); `notInArray` with an empty
   * list is otherwise invalid SQL, so that case is special-cased.
   */
  async deleteMissing(repoId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      await this.db
        .delete(t.projectContextDocuments)
        .where(eq(t.projectContextDocuments.repoId, repoId));
      return;
    }
    await this.db
      .delete(t.projectContextDocuments)
      .where(
        and(
          eq(t.projectContextDocuments.repoId, repoId),
          notInArray(t.projectContextDocuments.path, paths),
        ),
      );
  }

  async listDocuments(repoId: string): Promise<ProjectContextDocumentRow[]> {
    return this.db
      .select()
      .from(t.projectContextDocuments)
      .where(eq(t.projectContextDocuments.repoId, repoId))
      .orderBy(asc(t.projectContextDocuments.path));
  }

  async getDocument(repoId: string, path: string): Promise<ProjectContextDocumentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.projectContextDocuments)
      .where(
        and(eq(t.projectContextDocuments.repoId, repoId), eq(t.projectContextDocuments.path, path)),
      );
    return row;
  }

  /**
   * Per-path count of DISTINCT agents whose *effective* context set contains
   * that document (AC-11): agents with a direct attachment, UNION agents
   * linked (via `agent_skills`) to a skill that both has the attachment AND
   * is `enabled = true` — the same two-gate rule
   * `modules/reviews/prompt-context.ts::resolveAgentSkills` applies (linked
   * AND globally enabled), not a third variant of it. `UNION` (not `UNION
   * ALL`) already de-dupes identical `(path, agent_id)` pairs from the two
   * sources before the count, so a straight `GROUP BY` is enough. A path with
   * zero agents is simply absent from the result — callers default to 0.
   */
  async usedByAgentCounts(repoId: string): Promise<Map<string, number>> {
    const rows = await this.db.execute<{ path: string; count: number }>(sql`
      SELECT path, COUNT(*)::int AS count
      FROM (
        SELECT path, agent_id
        FROM context_attachments
        WHERE repo_id = ${repoId} AND agent_id IS NOT NULL
        UNION
        SELECT ca.path AS path, ask.agent_id AS agent_id
        FROM context_attachments ca
        JOIN skills sk ON sk.id = ca.skill_id
        JOIN agent_skills ask ON ask.skill_id = sk.id
        WHERE ca.repo_id = ${repoId} AND ca.skill_id IS NOT NULL AND sk.enabled = true
      ) effective
      GROUP BY path
    `);
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.path, Number(row.count));
    return counts;
  }

  /**
   * Per-path list of the (agent or skill) owners whose attached hash no
   * longer matches the document's current content hash (AC-36), named with
   * the exact `{owner_kind, owner_id, owner_name}` shape the drift-detail
   * (AC-38) and confirm (AC-37) endpoints take — so a document-list
   * consumer can act on a drift directly, with ONE query rather than an
   * N+1 fan-out per document. Modelled on `usedByAgentCounts` above: a
   * direct agent attachment always counts; a direct skill attachment counts
   * only under the SAME two-gate rule `usedByAgentCounts` applies to
   * skill-derived rows (`enabled = true` AND linked to at least one agent
   * via `agent_skills`) — an attachment on a disabled or unlinked skill
   * currently reaches no review, so it is not surfaced as an actionable
   * drift owner here (its own `drift` boolean on `ProjectContextDocument`,
   * which this method does not touch, still reflects it). A path with no
   * drifted owner is simply absent from the result — callers default to
   * `[]`.
   */
  async driftedFor(repoId: string): Promise<Map<string, ProjectContextDriftOwner[]>> {
    const rows = await this.db.execute<{
      path: string;
      owner_kind: 'agent' | 'skill';
      owner_id: string;
      owner_name: string;
    }>(sql`
      SELECT path, owner_kind, owner_id, owner_name
      FROM (
        SELECT ca.path AS path, 'agent'::text AS owner_kind, a.id::text AS owner_id, a.name AS owner_name
        FROM context_attachments ca
        JOIN project_context_documents pcd
          ON pcd.repo_id = ca.repo_id AND pcd.path = ca.path
        JOIN agents a ON a.id = ca.agent_id
        WHERE ca.repo_id = ${repoId}
          AND ca.agent_id IS NOT NULL
          AND ca.attached_hash <> pcd.content_hash
        UNION
        SELECT ca.path AS path, 'skill'::text AS owner_kind, sk.id::text AS owner_id, sk.name AS owner_name
        FROM context_attachments ca
        JOIN project_context_documents pcd
          ON pcd.repo_id = ca.repo_id AND pcd.path = ca.path
        JOIN skills sk ON sk.id = ca.skill_id
        WHERE ca.repo_id = ${repoId}
          AND ca.skill_id IS NOT NULL
          AND ca.attached_hash <> pcd.content_hash
          AND sk.enabled = true
          AND EXISTS (SELECT 1 FROM agent_skills ask WHERE ask.skill_id = sk.id)
      ) drifted
      ORDER BY path
    `);
    const byPath = new Map<string, ProjectContextDriftOwner[]>();
    for (const row of rows) {
      const owners = byPath.get(row.path) ?? [];
      owners.push({ owner_kind: row.owner_kind, owner_id: row.owner_id, owner_name: row.owner_name });
      byPath.set(row.path, owners);
    }
    return byPath;
  }

  // ---- context_attachments --------------------------------------------------

  /** Attachments for one owner (agent or skill), in prompt order (AC-14). */
  async listAttachments(owner: AttachmentOwnerRef): Promise<ContextAttachmentRow[]> {
    return this.db
      .select()
      .from(t.contextAttachments)
      .where(ownerWhere(owner))
      .orderBy(asc(t.contextAttachments.order));
  }

  async getAttachment(
    owner: AttachmentOwnerRef,
    repoId: string,
    path: string,
  ): Promise<ContextAttachmentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.contextAttachments)
      .where(
        and(ownerWhere(owner), eq(t.contextAttachments.repoId, repoId), eq(t.contextAttachments.path, path)),
      );
    return row;
  }

  /**
   * Replaces the full attachment set for one owner with `rows`, assigning
   * `order = index` so the persisted order is always contiguous (AC-14) —
   * delete-then-insert inside `db.transaction` so a partial write can never
   * leave the owner with a gap-ridden order. Idempotent: calling this twice
   * with the same list leaves exactly one row per `(owner, repo_id, path)`
   * (AC-15). An empty `rows` clears the owner's attachments and returns
   * without resolving a workspace (nothing to insert).
   */
  async replaceAttachments(owner: AttachmentOwnerRef, rows: ReplaceAttachmentInput[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.contextAttachments).where(ownerWhere(owner));
      if (rows.length === 0) return;
      const workspaceId = await this.resolveOwnerWorkspaceId(tx, owner);
      await tx.insert(t.contextAttachments).values(
        rows.map((r, i) => ({
          workspaceId,
          agentId: 'agentId' in owner ? owner.agentId : null,
          skillId: 'skillId' in owner ? owner.skillId : null,
          repoId: r.repoId,
          path: r.path,
          order: i,
          attachedHash: r.attachedHash,
          attachedSize: r.attachedSize,
          attachedRevision: r.attachedRevision,
        })),
      );
    });
  }

  /** Advances the recorded hash/size/revision to the current content (AC-37) —
   *  the drift marker is computed at read time by comparing this against the
   *  document's live `content_hash`, so there is no separate flag to clear. */
  async updateAttachedHash(
    owner: AttachmentOwnerRef,
    repoId: string,
    path: string,
    input: UpdateAttachedHashInput,
  ): Promise<void> {
    await this.db
      .update(t.contextAttachments)
      .set({
        attachedHash: input.attachedHash,
        attachedSize: input.attachedSize,
        attachedRevision: input.attachedRevision,
      })
      .where(
        and(ownerWhere(owner), eq(t.contextAttachments.repoId, repoId), eq(t.contextAttachments.path, path)),
      );
  }

  /**
   * Distinct paths in `repoId` that are attached AND whose attached hash no
   * longer matches the document's current content hash (AC-36). A document
   * with no matching row in `project_context_documents` (deleted from the
   * clone since attach) is excluded here — that's a "missing" outcome, not a
   * drift one, and is the caller's concern, not this query's.
   */
  async driftedPaths(repoId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ path: t.contextAttachments.path })
      .from(t.contextAttachments)
      .innerJoin(
        t.projectContextDocuments,
        and(
          eq(t.projectContextDocuments.repoId, t.contextAttachments.repoId),
          eq(t.projectContextDocuments.path, t.contextAttachments.path),
        ),
      )
      .where(
        and(
          eq(t.contextAttachments.repoId, repoId),
          ne(t.contextAttachments.attachedHash, t.projectContextDocuments.contentHash),
        ),
      );
    return rows.map((r) => r.path);
  }

  /** Resolves the workspace an owner (agent/skill) belongs to, so
   *  `replaceAttachments` can populate `context_attachments.workspace_id`
   *  (`not null`) without requiring every caller to pass it through. */
  private async resolveOwnerWorkspaceId(exec: Executor, owner: AttachmentOwnerRef): Promise<string> {
    if ('agentId' in owner) {
      const [row] = await exec
        .select({ workspaceId: t.agents.workspaceId })
        .from(t.agents)
        .where(eq(t.agents.id, owner.agentId));
      if (!row) throw new Error(`Unknown agent: ${owner.agentId}`);
      return row.workspaceId;
    }
    const [row] = await exec
      .select({ workspaceId: t.skills.workspaceId })
      .from(t.skills)
      .where(eq(t.skills.id, owner.skillId));
    if (!row) throw new Error(`Unknown skill: ${owner.skillId}`);
    return row.workspaceId;
  }
}
