/**
 * project-context — application service (T9). Orchestrates the reader
 * (`scanDocuments`), the repository (`ProjectContextRepository`), and two
 * ports reached only through the container (`container.git`,
 * `container.tokenizer`) — never a concrete git/tokenizer implementation
 * imported directly here (onion rule).
 *
 * Every path this service hands to a filesystem read is re-resolved and
 * containment-checked here, even when it came out of the
 * `project_context_documents` table — that table is populated from a scan of
 * user-controlled repo contents, so trusting a stored path without
 * re-checking it would reopen exactly the symlink-escape hole the reader
 * (AC-3) already closes once. The actual check lives in the shared
 * `../_shared/clone-path-guard.js` (`resolveInClone`), also used by
 * `../reviews/prompt-context.js` — see `readClonePath` below, which mirrors
 * the two-guard shape of `modules/reviews/intent/docs.ts`.
 */
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import type {
  EffectiveProjectContext,
  EffectiveProjectContextDoc,
  ProjectContextAttachment,
  ProjectContextDocType,
  ProjectContextDocument,
  ProjectContextDrift,
  ProjectContextListResponse,
  ProjectContextPreview,
  ProjectContextRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { planBudget } from '../_shared/context-budget.js';
import { resolveInClone } from '../_shared/clone-path-guard.js';
import { mergeEffectiveSet } from './helpers.js';
import { scanDocuments } from './reader.js';
import {
  ProjectContextRepository,
  type AttachmentOwnerRef,
  type ContextAttachmentRow,
  type ProjectContextDocumentRow,
  type ReplaceAttachmentInput,
  type UpsertDocumentInput,
} from './repository.js';

/** The `repos` row shape as returned by `container.reviewRepo.getRepo` — the
 *  shared, already-wired cross-module entry point for reading a repo by id
 *  (onion rule: reach another module's capability via `container.*`, never
 *  import that module's repository file directly). */
type RepoRow = NonNullable<Awaited<ReturnType<Container['reviewRepo']['getRepo']>>>;

export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  // ---------------------------------------------------------------------
  // Discovery (AC-4, AC-6, AC-7, AC-8, AC-43)
  // ---------------------------------------------------------------------

  /** Discovers/refreshes the document list for `repoId` (workspace-scoped).
   *  Returns `{documents: [], reason: 'not_cloned'}` with no error when the
   *  repo has no clone yet (AC-4).
   *
   *  Serves from `project_context_documents` once a scan has happened at
   *  least once for this repo — a plain DB read, no filesystem walk, no
   *  tokenizer calls, no upsert/delete — and only falls back to the full
   *  walk (`scanAndBuildResponse`, same as `rescan()` minus the fetch) when
   *  that table is empty for this repo (never scanned yet), so a first-ever
   *  page load is byte-identical to before this change. This route has no
   *  rate limit (unlike `rescan()`'s 6/min — a git fetch is worth limiting,
   *  a cached DB read is not) precisely because it no longer does the
   *  expensive work the limit was protecting: an unlimited GET that ran a
   *  recursive tree walk plus upserts on every call was the actual
   *  amplification path, not the limited `rescan()` POST. A file that
   *  changed on disk WITHOUT going through `rescan()` (e.g. some other
   *  process touched the clone) will not be reflected here until the user
   *  clicks rescan — this endpoint is deliberately no longer "walk on every
   *  load"; `preview()` already reads live content on demand for the one
   *  document actually being viewed, so staleness here is bounded by that. */
  async list(workspaceId: string, repoId: string): Promise<ProjectContextListResponse> {
    const repo = await this.getWorkspaceRepo(workspaceId, repoId);
    if (repo.clonePath !== null) {
      const existing = await this.repo.listDocuments(repo.id);
      if (existing.length > 0) return this.buildCachedResponse(repo, existing);
    }
    return this.scanAndBuildResponse(repo, { resync: false });
  }

  /**
   * User-triggered rescan (AC-6). ALWAYS walks (never serves `list()`'s
   * cached persisted-rows response, whatever the state of
   * `project_context_documents`) — this is the one explicit "go look at the
   * clone again" action, so it must never answer from a stale table. Per
   * document it still only recomputes what changed (AC-8: reuse a token
   * estimate while its content hash is unchanged) — but it FIRST advances
   * the clone to `origin/<defaultBranch>`.
   *
   * That fetch is the whole point of the button. The walk reads the checkout
   * on disk, so without it a rescan can only ever re-report the revision the
   * clone was last left at: a repo that grew a `docs/` directory after it was
   * imported stays permanently empty here no matter how often the user
   * clicks. Nothing else in the request path fetches — `POST /repos/:id/resync`
   * (repo-intel) is the only other caller of `git.sync`, and it is not
   * reachable from this page.
   *
   * A failed fetch DEGRADES, never throws: the walk still runs against the
   * stale clone and the reason travels back as `sync_error` (AC-4's "empty is
   * an answer, not an error" shape). Offline, a revoked token, or a deleted
   * upstream branch must not turn the document list into a 500.
   *
   * Note this advances the clone WITHOUT re-running the repo-intel indexer,
   * so `repo_index_state.last_indexed_sha` can now trail the working tree.
   * That is safe by construction — the indexer is incremental from its own
   * recorded sha and falls back to a full reindex when that sha is
   * unreachable — but it is why this calls the `git` port directly rather
   * than borrowing repo-intel's `resyncRepo` (which also reindexes, and is
   * not on the `RepoIntel` port anyway).
   */
  async rescan(workspaceId: string, repoId: string): Promise<ProjectContextListResponse> {
    const repo = await this.getWorkspaceRepo(workspaceId, repoId);
    return this.scanAndBuildResponse(repo, { resync: true });
  }

  private async getWorkspaceRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.container.reviewRepo.getRepo(repoId);
    if (!repo || repo.workspaceId !== workspaceId) throw new NotFoundError('Repository not found');
    return repo;
  }

  private async scanAndBuildResponse(
    repo: RepoRow,
    opts: { resync: boolean },
  ): Promise<ProjectContextListResponse> {
    const roots = this.container.config.projectContextRoots;
    const conventionalFilenames = this.container.config.projectContextFilenames;
    const budgetTokens = this.container.config.projectContextBudgetTokens;

    if (repo.clonePath === null) {
      return {
        documents: [],
        reason: 'not_cloned',
        scanned_at: new Date().toISOString(),
        roots,
        conventional_filenames: conventionalFilenames,
        budget_tokens: budgetTokens,
        clone_head: null,
      };
    }

    const ref = { owner: repo.owner, name: repo.name };

    // Fetch BEFORE the walk, so the scan below reads the revision the user
    // just asked for rather than the one the clone happened to be left at.
    let syncError: string | undefined;
    if (opts.resync) {
      try {
        await this.container.git.sync(ref, repo.defaultBranch);
      } catch (err) {
        syncError = err instanceof Error ? err.message : String(err);
      }
    }

    // Read HEAD after the fetch so the reported sha always describes the tree
    // the walk is about to read — including when the fetch failed and it is
    // therefore the OLD sha. Unreadable HEAD is a null, never a throw: a repo
    // whose clone is mid-checkout still deserves a document list.
    const cloneHead = await this.container.git.currentHead(ref).catch(() => null);

    const scan = await scanDocuments(repo.clonePath, {
      roots,
      conventionalFilenames,
      maxDocs: this.container.config.projectContextMaxDocs,
      maxFileBytes: this.container.config.projectContextMaxFileBytes,
    });

    const existing = await this.repo.listDocuments(repo.id);
    const existingByPath = new Map(existing.map((doc) => [doc.path, doc]));

    const upserts: UpsertDocumentInput[] = [];
    for (const doc of scan.documents) {
      const prior = existingByPath.get(doc.path);
      let tokens: number;
      if (prior && prior.contentHash === doc.content_hash) {
        // Unchanged since the last scan — reuse the persisted estimate, ZERO
        // tokenizer calls for this document (AC-8's cache hit).
        tokens = prior.tokens;
      } else {
        // New or changed content: the scan only carries a hash, not the
        // body, so re-read it here to count tokens — re-checking
        // containment rather than trusting the scan's own path (see the
        // module doc comment above).
        const buf = await this.readClonePath(repo.clonePath, doc.path);
        tokens = buf === null ? 0 : this.container.tokenizer.count(buf.toString('utf8'));
      }
      upserts.push({
        path: doc.path,
        type: doc.type as ProjectContextDocType,
        sizeBytes: doc.size_bytes,
        contentHash: doc.content_hash,
        tokens,
      });
    }

    await this.repo.upsertDocuments(repo.id, upserts);
    await this.repo.deleteMissing(
      repo.id,
      scan.documents.map((doc) => doc.path),
    );

    const usedByCounts = await this.repo.usedByAgentCounts(repo.id);
    const driftedSet = new Set(await this.repo.driftedPaths(repo.id));
    const driftedForMap = await this.repo.driftedFor(repo.id);

    const documents: ProjectContextDocument[] = upserts.map((doc) => ({
      path: doc.path,
      type: doc.type,
      size_bytes: doc.sizeBytes,
      content_hash: doc.contentHash,
      tokens: doc.tokens,
      used_by_agents: usedByCounts.get(doc.path) ?? 0,
      drift: driftedSet.has(doc.path) ? true : undefined,
      drifted_for: driftedForMap.get(doc.path) ?? [],
    }));

    const omitted =
      scan.omitted.by_count > 0 || scan.omitted.by_size > 0 ? scan.omitted : undefined;

    return {
      documents,
      scanned_at: new Date().toISOString(),
      roots,
      conventional_filenames: conventionalFilenames,
      budget_tokens: budgetTokens,
      omitted,
      clone_head: cloneHead,
      ...(syncError !== undefined ? { sync_error: syncError } : {}),
    };
  }

  /**
   * Builds `list()`'s response straight from already-persisted
   * `project_context_documents` rows — no walk, no tokenizer, no
   * upsert/delete. `existing` is assumed non-empty (the caller only takes
   * this path once a scan has happened at least once for this repo).
   *
   * `scanned_at` is the MOST RECENT row's `scannedAt` rather than "now" — it
   * genuinely describes when the underlying data was last produced by a
   * walk, which for a cached response is not this call. `omitted` (the
   * discovery caps counter) has no persisted equivalent — a scan's
   * dropped-by-cap counts are a property of that one walk, not of any row —
   * so it is simply absent here; a `rescan()` recomputes it.
   */
  private async buildCachedResponse(
    repo: RepoRow,
    existing: ProjectContextDocumentRow[],
  ): Promise<ProjectContextListResponse> {
    const roots = this.container.config.projectContextRoots;
    const conventionalFilenames = this.container.config.projectContextFilenames;
    const budgetTokens = this.container.config.projectContextBudgetTokens;

    const ref = { owner: repo.owner, name: repo.name };
    const cloneHead = await this.container.git.currentHead(ref).catch(() => null);

    const usedByCounts = await this.repo.usedByAgentCounts(repo.id);
    const driftedSet = new Set(await this.repo.driftedPaths(repo.id));
    const driftedForMap = await this.repo.driftedFor(repo.id);

    const documents: ProjectContextDocument[] = existing.map((doc) => ({
      path: doc.path,
      type: doc.type as ProjectContextDocType,
      size_bytes: doc.sizeBytes,
      content_hash: doc.contentHash,
      tokens: doc.tokens,
      used_by_agents: usedByCounts.get(doc.path) ?? 0,
      drift: driftedSet.has(doc.path) ? true : undefined,
      drifted_for: driftedForMap.get(doc.path) ?? [],
    }));

    const scannedAt = existing.reduce(
      (latest, doc) => (doc.scannedAt > latest ? doc.scannedAt : latest),
      existing[0]!.scannedAt,
    );

    return {
      documents,
      scanned_at: scannedAt.toISOString(),
      roots,
      conventional_filenames: conventionalFilenames,
      budget_tokens: budgetTokens,
      clone_head: cloneHead,
    };
  }

  // ---------------------------------------------------------------------
  // Preview (AC-10, AC-11)
  // ---------------------------------------------------------------------

  /** Containment-checked read of a document's body, capped at the configured
   *  preview length (AC-10). Throws `NotFoundError` for anything not a
   *  currently-known, currently-readable document under the repo's clone —
   *  never a partial/best-effort body. */
  async preview(repoId: string, relPath: string): Promise<ProjectContextPreview> {
    const repo = await this.container.reviewRepo.getRepo(repoId);
    if (!repo || repo.clonePath === null) throw new NotFoundError('Document not found');

    const doc = await this.repo.getDocument(repoId, relPath);
    if (!doc) throw new NotFoundError('Document not found');

    const buf = await this.readClonePath(repo.clonePath, relPath);
    if (buf === null) throw new NotFoundError('Document not found');

    const cap = this.container.config.projectContextPreviewChars;
    const text = buf.toString('utf8');
    const truncated = text.length > cap;

    const usedByCounts = await this.repo.usedByAgentCounts(repoId);
    const driftedSet = new Set(await this.repo.driftedPaths(repoId));
    const driftedForMap = await this.repo.driftedFor(repoId);

    return {
      path: relPath,
      type: doc.type,
      size_bytes: doc.sizeBytes,
      content_hash: doc.contentHash,
      tokens: doc.tokens,
      used_by_agents: usedByCounts.get(relPath) ?? 0,
      drift: driftedSet.has(relPath) ? true : undefined,
      drifted_for: driftedForMap.get(relPath) ?? [],
      body: truncated ? text.slice(0, cap) : text,
      truncated,
    };
  }

  // ---------------------------------------------------------------------
  // Attaching (AC-12..AC-15, AC-19, AC-35)
  // ---------------------------------------------------------------------

  /**
   * Replaces an agent's full attachment set with `refs`, in order (AC-14),
   * then bumps the agent's version with the resulting ordered ref list
   * (AC-19). A ref already attached keeps its PREVIOUSLY recorded
   * `attached_hash`/`attached_size`/`attached_revision` untouched — only a
   * newly-added ref gets a fresh snapshot of the current file (AC-35) — so
   * re-saving an unrelated change (e.g. reordering, or adding one more
   * document) never resets another document's drift marker (AC-36) by
   * silently re-stamping it as "attached now". Calling this twice with the
   * same `refs` is a no-op beyond the redundant read (AC-15): the resulting
   * rows are identical, and `bumpVersionWithContext` itself no-ops on an
   * unchanged ordered list.
   *
   * `workspaceId` gates every ref: `assertRefsInWorkspace` throws before any
   * attachment row is built/persisted if a single `ref.repo_id` resolves to a
   * repo outside this workspace — this is the ONE place both callers
   * (agents PUT and skills PUT) funnel through, so neither can forget the
   * check (a route-level check is still kept as defence in depth, see
   * `project-context/routes.ts`'s `assertRefsInWorkspace`).
   *
   * A ref whose document can't currently be read (not cloned, missing,
   * escapes the clone) is silently dropped rather than failing the whole
   * save — consistent with this feature's "degrade, never block" rule.
   */
  async setAgentContext(workspaceId: string, agentId: string, refs: ProjectContextRef[]) {
    await this.assertRefsInWorkspace(workspaceId, refs);
    const owner: AttachmentOwnerRef = { agentId };
    const rows = await this.buildAttachmentRows(owner, refs);
    await this.repo.replaceAttachments(owner, rows);
    const orderedRefs: ProjectContextRef[] = rows.map((r) => ({ repo_id: r.repoId, path: r.path }));
    return this.container.agentsRepo.bumpVersionWithContext(agentId, orderedRefs);
  }

  /** Same as `setAgentContext`, for a skill's attachment set — minus the
   *  version bump, which T16 owns as part of skill save-time versioning
   *  (AC-39, AC-42 compare body AND attachments before deciding whether a
   *  new skill version snapshot is warranted). Same `workspaceId` ref-gating
   *  as `setAgentContext` — see that method's doc comment. */
  async setSkillContext(
    workspaceId: string,
    skillId: string,
    refs: ProjectContextRef[],
  ): Promise<void> {
    await this.assertRefsInWorkspace(workspaceId, refs);
    const owner: AttachmentOwnerRef = { skillId };
    const rows = await this.buildAttachmentRows(owner, refs);
    await this.repo.replaceAttachments(owner, rows);
  }

  /**
   * Rejects any ref whose `repo_id` does not resolve to a repo owned by
   * `workspaceId` — the single choke point `setAgentContext` and
   * `setSkillContext` both funnel through, so a workspace-B repo id can never
   * reach `buildAttachmentRows`/`currentDocMeta` (which reads the file
   * straight out of that repo's clone, unscoped) regardless of which route
   * called in. Throws `NotFoundError` on the first offending id — same
   * "not found" semantics as `getWorkspaceRepo` above and the route-level
   * `assertRepoInWorkspace` in `project-context/routes.ts`.
   */
  private async assertRefsInWorkspace(
    workspaceId: string,
    refs: readonly { repo_id: string }[],
  ): Promise<void> {
    const repoIds = [...new Set(refs.map((r) => r.repo_id))];
    for (const repoId of repoIds) {
      const repo = await this.container.reviewRepo.getRepo(repoId);
      if (!repo || repo.workspaceId !== workspaceId) {
        throw new NotFoundError('Repository not found');
      }
    }
  }

  private async buildAttachmentRows(
    owner: AttachmentOwnerRef,
    refs: ProjectContextRef[],
  ): Promise<ReplaceAttachmentInput[]> {
    const existing = await this.repo.listAttachments(owner);
    const existingByKey = new Map(existing.map((row) => [attachKey(row.repoId, row.path), row]));
    const headCache = new Map<string, string>();
    const rows: ReplaceAttachmentInput[] = [];

    for (const ref of refs) {
      // A ref is only ever a valid attachment target if it is a discovered
      // document (a `project_context_documents` row) — never merely a path
      // that survives `resolveInClone`'s containment check. This gate must
      // run even for a ref that already has a `prior` row: without it, a
      // path attached before this check existed (e.g. `.git/config`, stamped
      // via the pre-fix version of this method) would keep being silently
      // re-confirmed forever through the fast path below, which reuses the
      // stored hash without ever re-reading the file. Skipped, not thrown —
      // one stale/malicious path in a larger `refs` set must not fail the
      // whole save (matches the "degrade, never block" rule documented on
      // `setAgentContext`).
      const doc = await this.repo.getDocument(ref.repo_id, ref.path);
      if (!doc) continue;

      const prior = existingByKey.get(attachKey(ref.repo_id, ref.path));
      if (prior) {
        rows.push({
          repoId: ref.repo_id,
          path: ref.path,
          attachedHash: prior.attachedHash,
          attachedSize: prior.attachedSize,
          attachedRevision: prior.attachedRevision,
        });
        continue;
      }

      const meta = await this.currentDocMeta(ref.repo_id, ref.path, headCache);
      if (meta === null) continue;
      rows.push({
        repoId: ref.repo_id,
        path: ref.path,
        attachedHash: meta.hash,
        attachedSize: meta.size,
        attachedRevision: meta.revision,
      });
    }

    return rows;
  }

  /** Reads the CURRENT file content + clone revision for `(repoId, relPath)`
   *  — used both to stamp a brand-new attachment (AC-35) and to advance a
   *  confirmed one (AC-37). `headCache` avoids one `currentHead` git call per
   *  ref when several refs in the same `setAgentContext`/`setSkillContext`
   *  call share a repo. Returns null (never throws) when the repo isn't
   *  cloned or the file can't currently be read. */
  private async currentDocMeta(
    repoId: string,
    relPath: string,
    headCache?: Map<string, string>,
  ): Promise<{ hash: string; size: number; revision: string } | null> {
    const repo = await this.container.reviewRepo.getRepo(repoId);
    if (!repo || repo.clonePath === null) return null;

    const buf = await this.readClonePath(repo.clonePath, relPath);
    if (buf === null) return null;

    let revision = headCache?.get(repoId);
    if (revision === undefined) {
      revision = await this.container.git.currentHead({ owner: repo.owner, name: repo.name });
      headCache?.set(repoId, revision);
    }

    return { hash: sha256Hex(buf), size: buf.length, revision };
  }

  /**
   * A skill's own ordered attachment list (AC-13), with per-row drift
   * computed the same way it's computed everywhere else in this service —
   * attached hash vs. the document's current content hash. Backs
   * `GET /skills/:id/context`; moved here from the route handler (which
   * previously called `container.projectContextRepo` directly) so this
   * response assembly and the drift comparison live in the Application
   * layer rather than Transport reaching into Infrastructure.
   */
  async skillContext(skillId: string): Promise<ProjectContextAttachment[]> {
    const rows = await this.repo.listAttachments({ skillId });
    const out: ProjectContextAttachment[] = [];
    for (const row of rows) {
      const doc = await this.repo.getDocument(row.repoId, row.path);
      out.push({
        repo_id: row.repoId,
        path: row.path,
        order: row.order,
        attached_hash: row.attachedHash,
        attached_size: row.attachedSize,
        attached_revision: row.attachedRevision,
        drift: doc && doc.contentHash !== row.attachedHash ? true : undefined,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Effective context set (AC-16, AC-17, AC-40)
  // ---------------------------------------------------------------------

  /** An agent's effective context set: its own attachments followed by the
   *  attachments of every skill that is BOTH linked to it AND globally
   *  enabled (the two-gate rule `resolveAgentSkills` already applies to
   *  skill bodies — `modules/reviews/prompt-context.ts`), de-duplicated by
   *  `(repo_id, path)` keeping the first occurrence (AC-16), with the
   *  summed token estimate against the configured budget (AC-17, AC-40). */
  async effectiveContext(agentId: string): Promise<EffectiveProjectContext> {
    const ownRows = await this.repo.listAttachments({ agentId });
    const linked = await this.container.agentsRepo.linkedSkills(agentId);
    const enabledLinked = linked.filter((link) => link.skill.enabled === true);

    const ownDocs = await this.toEffectiveDocs(ownRows, 'agent');
    const skillDocs: EffectiveProjectContextDoc[] = [];
    for (const link of enabledLinked) {
      const rows = await this.repo.listAttachments({ skillId: link.skill.id });
      skillDocs.push(...(await this.toEffectiveDocs(rows, 'skill', link.skill.id)));
    }

    const merged = mergeEffectiveSet(ownDocs, skillDocs);
    const totalTokens = merged.reduce((sum, doc) => sum + doc.tokens, 0);
    const budgetTokens = this.container.config.projectContextBudgetTokens;
    const { dropped } = planBudget(merged, budgetTokens);

    return {
      documents: merged,
      total_tokens: totalTokens,
      budget_tokens: budgetTokens,
      over_budget: totalTokens > budgetTokens,
      dropped_paths: dropped.map((doc) => doc.path),
    };
  }

  private async toEffectiveDocs(
    rows: ContextAttachmentRow[],
    source: 'agent' | 'skill',
    skillId?: string,
  ): Promise<EffectiveProjectContextDoc[]> {
    const out: EffectiveProjectContextDoc[] = [];
    for (const row of rows) {
      // A document that's been attached but then vanished from the last
      // scan (deleted, or never scanned yet) has no row here — that's a
      // run-time "missing" outcome (AC-22), not this method's concern, so it
      // is simply omitted from the effective set rather than guessed at.
      const doc = await this.repo.getDocument(row.repoId, row.path);
      if (!doc) continue;
      out.push({
        repo_id: row.repoId,
        path: row.path,
        type: doc.type,
        tokens: doc.tokens,
        source,
        ...(skillId !== undefined ? { skill_id: skillId } : {}),
        drift: row.attachedHash !== doc.contentHash,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Drift (AC-36, AC-37, AC-38)
  // ---------------------------------------------------------------------

  /** Drift detail: the document at its attach-time revision vs. its current
   *  content (AC-38). Degrades to `previous_unavailable: true` — never
   *  throws — when `attached_revision` no longer resolves in the clone
   *  (force-push, GC); `container.git.readFileAt` rejects in exactly that
   *  case, which is the signal this catches, not an error to propagate. */
  async drift(owner: AttachmentOwnerRef, repoId: string, relPath: string): Promise<ProjectContextDrift> {
    const attachment = await this.repo.getAttachment(owner, repoId, relPath);
    if (!attachment) throw new NotFoundError('Attachment not found');

    const repo = await this.container.reviewRepo.getRepo(repoId);
    if (!repo || repo.clonePath === null) throw new NotFoundError('Repository clone not found');

    // An attachment row alone is not proof the path is safe to read back out
    // of the clone — it may have been persisted before this check existed,
    // or (pre-fix) for any path that merely survived `resolveInClone`'s
    // containment check. Require it to still be a discovered document, same
    // as `preview()` (AC-10/AC-11) — same error shape, so this never leaks
    // whether the underlying file exists on disk.
    const doc = await this.repo.getDocument(repoId, relPath);
    if (!doc) throw new NotFoundError('Document not found');

    const currentBuf = await this.readClonePath(repo.clonePath, relPath);
    const current = currentBuf === null ? '' : currentBuf.toString('utf8');

    let previous: string | undefined;
    let previousUnavailable = false;
    try {
      previous = await this.container.git.readFileAt(
        { owner: repo.owner, name: repo.name },
        attachment.attachedRevision,
        relPath,
      );
    } catch {
      previousUnavailable = true;
    }

    return {
      path: relPath,
      attached_revision: attachment.attachedRevision,
      previous,
      current,
      previous_unavailable: previousUnavailable,
    };
  }

  /** Advances the recorded hash/size/revision to the document's CURRENT
   *  content, clearing the drift marker (it is computed at read time by
   *  comparing against the live content hash — there is no separate flag).
   *  Reads only; the clone itself is never written (AC-37). */
  async confirm(owner: AttachmentOwnerRef, repoId: string, relPath: string): Promise<void> {
    const attachment = await this.repo.getAttachment(owner, repoId, relPath);
    if (!attachment) throw new NotFoundError('Attachment not found');

    // Same reasoning as `drift()` above: an attachment row is not proof the
    // path is a discovered document, so gate the read the same way before
    // advancing the recorded hash/size/revision.
    const doc = await this.repo.getDocument(repoId, relPath);
    if (!doc) throw new NotFoundError('Document not found');

    const meta = await this.currentDocMeta(repoId, relPath);
    if (meta === null) throw new NotFoundError('Document not found in clone');

    await this.repo.updateAttachedHash(owner, repoId, relPath, {
      attachedHash: meta.hash,
      attachedSize: meta.size,
      attachedRevision: meta.revision,
    });
  }

  // ---------------------------------------------------------------------
  // Filesystem — containment-checked reads only (see module doc comment)
  // ---------------------------------------------------------------------

  /** Realpath-resolves `clonePath` (the clone root itself — on macOS a
   *  `/tmp` clone realpaths to `/private/tmp`, so this must happen before any
   *  comparison) and delegates the actual containment check to the shared
   *  `resolveInClone` guard (`../_shared/clone-path-guard.js`), also used by
   *  `../reviews/prompt-context.js`. Returns null (never throws) for
   *  anything that fails any check. */
  private async readClonePath(clonePath: string, relPath: string): Promise<Buffer | null> {
    const root = await realpath(clonePath).catch(() => null);
    if (root === null) return null;

    const real = await resolveInClone(root, relPath);
    if (real === null) return null;
    return readFile(real).catch(() => null);
  }
}

function attachKey(repoId: string, path: string): string {
  return `${repoId} ${path}`;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
