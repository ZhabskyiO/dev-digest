/**
 * T9 — `ProjectContextService` (AC-4, AC-8, AC-15, AC-35, AC-37, AC-38).
 *
 * Hermetic — a real temp directory on disk for the "clone", no DB. Follows
 * the established no-DB service unit-test pattern (see
 * `test/repo-intel-resync.test.ts`): a fake `Container` with `db: {}` (never
 * queried) and the service's private `repo` field overridden with an
 * in-memory stand-in for `ProjectContextRepository`, cast around the type
 * system exactly like that precedent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import type {
  AttachmentOwnerRef,
  ContextAttachmentRow,
  ProjectContextDocumentRow,
  ProjectContextRepository,
  ReplaceAttachmentInput,
  UpdateAttachedHashInput,
  UpsertDocumentInput,
} from '../src/modules/project-context/repository.js';
import type { ProjectContextDriftOwner } from '@devdigest/shared';
import { MockGitClient } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';

const CONFIG = {
  projectContextRoots: ['specs', 'docs', 'insights'],
  projectContextFilenames: ['insights.md'],
  projectContextBudgetTokens: 12_000,
  projectContextDocCharCap: 16_000,
  projectContextMaxDocs: 500,
  projectContextMaxFileBytes: 1_048_576,
  projectContextPreviewChars: 4_000,
};

interface FakeRepoRow {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

function ownerKey(owner: AttachmentOwnerRef): string {
  return 'agentId' in owner ? `agent:${owner.agentId}` : `skill:${owner.skillId}`;
}
function docKey(repoId: string, docPath: string): string {
  return `${repoId}\x00${docPath}`;
}

/** In-memory stand-in for `ProjectContextRepository` — same public shape,
 *  no DB. Used only via the cast override, mirroring
 *  `repo-intel-resync.test.ts`'s pattern for `RepoIntelRepository`. */
class FakeProjectContextRepository {
  documents = new Map<string, ProjectContextDocumentRow>();
  attachments = new Map<string, ContextAttachmentRow>();
  /** Fix 3 — per-path drift-owner map. Real `ProjectContextRepository`
   *  computes this with a SQL join (see `project-context-repository.it.test.ts`
   *  for the two-gate-rule coverage that needs); this hermetic stand-in just
   *  returns whatever the test pre-seeds, so tests here only prove the
   *  SERVICE plumbs the map into `documents[].drifted_for` correctly. */
  driftOwners = new Map<string, ProjectContextDriftOwner[]>();
  private seq = 0;

  async upsertDocuments(repoId: string, rows: UpsertDocumentInput[]): Promise<void> {
    for (const r of rows) {
      const key = docKey(repoId, r.path);
      const prior = this.documents.get(key);
      if (prior && prior.contentHash === r.contentHash) continue; // mirrors setWhere no-op
      this.documents.set(key, {
        id: prior?.id ?? `doc-${this.seq++}`,
        repoId,
        path: r.path,
        type: r.type,
        sizeBytes: r.sizeBytes,
        contentHash: r.contentHash,
        tokens: r.tokens,
        scannedAt: new Date(),
      } as ProjectContextDocumentRow);
    }
  }

  async deleteMissing(repoId: string, paths: string[]): Promise<void> {
    const keep = new Set(paths);
    for (const [key, doc] of this.documents) {
      if (doc.repoId === repoId && !keep.has(doc.path)) this.documents.delete(key);
    }
  }

  async listDocuments(repoId: string): Promise<ProjectContextDocumentRow[]> {
    return [...this.documents.values()].filter((d) => d.repoId === repoId);
  }

  async getDocument(repoId: string, docPath: string): Promise<ProjectContextDocumentRow | undefined> {
    return this.documents.get(docKey(repoId, docPath));
  }

  async usedByAgentCounts(_repoId: string): Promise<Map<string, number>> {
    return new Map();
  }

  async driftedPaths(repoId: string): Promise<string[]> {
    const out: string[] = [];
    for (const a of this.attachments.values()) {
      if (a.repoId !== repoId) continue;
      const doc = this.documents.get(docKey(a.repoId, a.path));
      if (doc && doc.contentHash !== a.attachedHash) out.push(a.path);
    }
    return out;
  }

  async driftedFor(_repoId: string): Promise<Map<string, ProjectContextDriftOwner[]>> {
    return this.driftOwners;
  }

  async listAttachments(owner: AttachmentOwnerRef): Promise<ContextAttachmentRow[]> {
    const ok = ownerKey(owner);
    return [...this.attachments.values()]
      .filter((a) => (a.agentId ? `agent:${a.agentId}` : `skill:${a.skillId}`) === ok)
      .sort((a, b) => a.order - b.order);
  }

  async getAttachment(
    owner: AttachmentOwnerRef,
    repoId: string,
    docPath: string,
  ): Promise<ContextAttachmentRow | undefined> {
    const ok = ownerKey(owner);
    return [...this.attachments.values()].find(
      (a) =>
        (a.agentId ? `agent:${a.agentId}` : `skill:${a.skillId}`) === ok &&
        a.repoId === repoId &&
        a.path === docPath,
    );
  }

  async replaceAttachments(owner: AttachmentOwnerRef, rows: ReplaceAttachmentInput[]): Promise<void> {
    const ok = ownerKey(owner);
    for (const [key, a] of this.attachments) {
      if ((a.agentId ? `agent:${a.agentId}` : `skill:${a.skillId}`) === ok) this.attachments.delete(key);
    }
    rows.forEach((r, i) => {
      const id = `att-${this.seq++}`;
      this.attachments.set(id, {
        id,
        workspaceId: 'ws-1',
        agentId: 'agentId' in owner ? owner.agentId : null,
        skillId: 'skillId' in owner ? owner.skillId : null,
        repoId: r.repoId,
        path: r.path,
        order: i,
        attachedHash: r.attachedHash,
        attachedSize: r.attachedSize,
        attachedRevision: r.attachedRevision,
        createdAt: new Date(),
      } as ContextAttachmentRow);
    });
  }

  async updateAttachedHash(
    owner: AttachmentOwnerRef,
    repoId: string,
    docPath: string,
    input: UpdateAttachedHashInput,
  ): Promise<void> {
    const existing = await this.getAttachment(owner, repoId, docPath);
    if (!existing) return;
    this.attachments.set(existing.id, {
      ...existing,
      attachedHash: input.attachedHash,
      attachedSize: input.attachedSize,
      attachedRevision: input.attachedRevision,
    });
  }
}

function makeService(opts: {
  repos: FakeRepoRow[];
  git?: MockGitClient;
  tokenizerCount?: (text: string) => number;
  tokenizerCalls?: string[];
}) {
  const reposById = new Map(opts.repos.map((r) => [r.id, r]));
  const calls = opts.tokenizerCalls ?? [];
  const container = {
    db: {}, // never queried — service.repo is overridden below
    config: CONFIG,
    git: opts.git ?? new MockGitClient({ head: 'deadbeef' }),
    tokenizer: {
      count: (text: string) => {
        calls.push(text);
        return opts.tokenizerCount ? opts.tokenizerCount(text) : Math.ceil(text.length / 4);
      },
    },
    reviewRepo: {
      getRepo: async (id: string) => reposById.get(id),
    },
    agentsRepo: {
      bumpVersionWithContext: async (agentId: string, orderedRefs: unknown) => ({
        id: agentId,
        version: 2,
        _context: orderedRefs,
      }),
      linkedSkills: async () => [],
    },
  } as unknown as Container;

  const service = new ProjectContextService(container);
  const fakeRepo = new FakeProjectContextRepository();
  (service as unknown as { repo: ProjectContextRepository }).repo =
    fakeRepo as unknown as ProjectContextRepository;

  return { service, fakeRepo, calls };
}

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('ProjectContextService.list', () => {
  it('returns {documents: [], reason: "not_cloned"} with no error when the repo has no clone (AC-4)', async () => {
    const { service } = makeService({
      repos: [{ id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath: null }],
    });

    const result = await service.list('ws-1', 'r1');

    expect(result).toMatchObject({
      documents: [],
      reason: 'not_cloned',
      roots: CONFIG.projectContextRoots,
      conventional_filenames: CONFIG.projectContextFilenames,
      budget_tokens: CONFIG.projectContextBudgetTokens,
    });
  });

  describe('token cache reuse (AC-8)', () => {
    let clonePath: string;

    beforeEach(async () => {
      clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-pc-service-'));
      await writeFileAt(clonePath, 'specs/a.md', '# spec a');
      await writeFileAt(clonePath, 'docs/b.md', '# doc b');
    });

    afterEach(async () => {
      await rm(clonePath, { recursive: true, force: true });
    });

    it('populates drifted_for from the repository\'s per-path drift-owner map, and leaves it empty for an undrifted document (Fix 3)', async () => {
      const { service, fakeRepo } = makeService({
        repos: [
          { id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath },
        ],
      });

      const owners: ProjectContextDriftOwner[] = [
        { owner_kind: 'agent', owner_id: 'agent-1', owner_name: 'Agent One' },
        { owner_kind: 'skill', owner_id: 'skill-1', owner_name: 'Skill One' },
      ];
      fakeRepo.driftOwners.set('specs/a.md', owners);

      const result = await service.list('ws-1', 'r1');
      const a = result.documents.find((d) => d.path === 'specs/a.md');
      const b = result.documents.find((d) => d.path === 'docs/b.md');

      expect(a?.drifted_for).toEqual(owners);
      expect(b?.drifted_for).toEqual([]);
    });

    it('invokes the tokenizer once per document on the first scan, zero times on an unmodified second scan, and exactly once after editing one file', async () => {
      const { service, calls } = makeService({
        repos: [
          { id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath },
        ],
      });

      const first = await service.list('ws-1', 'r1');
      expect(first.documents).toHaveLength(2);
      expect(calls).toHaveLength(2); // one tokenizer call per new document

      calls.length = 0;
      const second = await service.list('ws-1', 'r1');
      expect(second.documents).toHaveLength(2);
      expect(calls).toHaveLength(0); // unchanged content hash — cache reused

      calls.length = 0;
      await writeFileAt(clonePath, 'specs/a.md', '# spec a, edited');
      const third = await service.list('ws-1', 'r1');
      expect(third.documents).toHaveLength(2);
      expect(calls).toHaveLength(1); // only the edited document is re-counted
    });
  });
});

describe('ProjectContextService.rescan', () => {
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-pc-rescan-'));
    await writeFileAt(clonePath, 'docs/already-here.md', '# present before the fetch');
  });

  afterEach(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  /** A git double whose `sync()` also materialises a file in the clone, the
   *  way a real fetch+reset brings down a directory that was pushed after the
   *  clone was made. Asserting on THIS file is what proves the fetch runs
   *  before the walk: a rescan that scanned first would never see it. */
  class FetchingGitClient extends MockGitClient {
    constructor(private dest: string, opts?: ConstructorParameters<typeof MockGitClient>[0]) {
      super(opts);
    }
    override async sync(repo: { owner: string; name: string }, branch: string) {
      const result = await super.sync(repo, branch);
      await writeFileAt(this.dest, 'docs/arrived-with-the-fetch.md', '# pushed after the clone');
      return result;
    }
  }

  it('fetches origin/<defaultBranch> BEFORE walking, so a document pushed after the clone shows up on the first rescan', async () => {
    const git = new FetchingGitClient(clonePath, { head: 'old11111', syncedHead: 'new22222' });
    const { service } = makeService({
      repos: [
        { id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath },
      ],
      git,
    });

    const result = await service.rescan('ws-1', 'r1');

    expect(git.syncs).toEqual([{ repo: { owner: 'acme', name: 'x' }, branch: 'main' }]);
    expect(result.documents.map((d) => d.path).sort()).toEqual([
      'docs/already-here.md',
      'docs/arrived-with-the-fetch.md',
    ]);
    // The reported sha describes the tree that was actually walked.
    expect(result.clone_head).toBe('new22222');
    expect(result.sync_error).toBeUndefined();
  });

  it('list() never fetches — it reports only what is already on disk, at the pre-fetch sha', async () => {
    const git = new FetchingGitClient(clonePath, { head: 'old11111', syncedHead: 'new22222' });
    const { service } = makeService({
      repos: [
        { id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath },
      ],
      git,
    });

    const result = await service.list('ws-1', 'r1');

    expect(git.syncs).toEqual([]);
    expect(result.documents.map((d) => d.path)).toEqual(['docs/already-here.md']);
    expect(result.clone_head).toBe('old11111');
  });

  it('degrades when the fetch fails: still returns the stale clone\'s documents, with sync_error and the OLD sha', async () => {
    const git = new MockGitClient({ head: 'old11111', syncError: 'fatal: could not read Username' });
    const { service } = makeService({
      repos: [
        { id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath },
      ],
      git,
    });

    const result = await service.rescan('ws-1', 'r1');

    expect(git.syncs).toHaveLength(1); // attempted
    expect(result.sync_error).toContain('could not read Username');
    expect(result.documents.map((d) => d.path)).toEqual(['docs/already-here.md']);
    expect(result.clone_head).toBe('old11111');
  });

  it('reports clone_head: null and never fetches when the repo has no clone (AC-4)', async () => {
    const git = new MockGitClient({ head: 'old11111' });
    const { service } = makeService({
      repos: [
        { id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath: null },
      ],
      git,
    });

    const result = await service.rescan('ws-1', 'r1');

    expect(result).toMatchObject({ documents: [], reason: 'not_cloned', clone_head: null });
    expect(git.syncs).toEqual([]);
  });
});

describe('ProjectContextService.confirm', () => {
  it('advances the recorded hash/size/revision without touching the file on disk (AC-37)', async () => {
    const clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-pc-confirm-'));
    try {
      await writeFileAt(clonePath, 'specs/a.md', '# original content');
      const before = await stat(path.join(clonePath, 'specs/a.md'));
      const beforeBuf = await import('node:fs/promises').then((m) =>
        m.readFile(path.join(clonePath, 'specs/a.md')),
      );

      const git = new MockGitClient({ head: 'rev-2' });
      const { service, fakeRepo } = makeService({
        repos: [{ id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath }],
        git,
      });

      // Seed an existing attachment as if it had drifted: stale hash/revision.
      await fakeRepo.replaceAttachments(
        { agentId: 'agent-1' },
        [{ repoId: 'r1', path: 'specs/a.md', attachedHash: 'stale-hash', attachedSize: 1, attachedRevision: 'rev-1' }],
      );

      await service.confirm({ agentId: 'agent-1' }, 'r1', 'specs/a.md');

      const updated = await fakeRepo.getAttachment({ agentId: 'agent-1' }, 'r1', 'specs/a.md');
      expect(updated?.attachedHash).not.toBe('stale-hash');
      expect(updated?.attachedRevision).toBe('rev-2');

      const after = await stat(path.join(clonePath, 'specs/a.md'));
      const afterBuf = await import('node:fs/promises').then((m) =>
        m.readFile(path.join(clonePath, 'specs/a.md')),
      );
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(afterBuf.equals(beforeBuf)).toBe(true);
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });
});

describe('ProjectContextService.setAgentContext', () => {
  it('is idempotent: attaching the same set twice leaves the same attachment unchanged (AC-15)', async () => {
    const clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-pc-attach-'));
    try {
      await writeFileAt(clonePath, 'specs/a.md', '# content');
      const { service, fakeRepo } = makeService({
        repos: [{ id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath }],
      });

      await service.setAgentContext('ws-1', 'agent-1', [{ repo_id: 'r1', path: 'specs/a.md' }]);
      const firstRow = await fakeRepo.getAttachment({ agentId: 'agent-1' }, 'r1', 'specs/a.md');

      await service.setAgentContext('ws-1', 'agent-1', [{ repo_id: 'r1', path: 'specs/a.md' }]);
      const secondRow = await fakeRepo.getAttachment({ agentId: 'agent-1' }, 'r1', 'specs/a.md');

      expect(secondRow?.attachedHash).toBe(firstRow?.attachedHash);
      expect((await fakeRepo.listAttachments({ agentId: 'agent-1' })).length).toBe(1);
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });

  it('adding a second document does not reset an already-attached document\'s recorded hash (AC-35/AC-36 preservation)', async () => {
    const clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-pc-attach2-'));
    try {
      await writeFileAt(clonePath, 'specs/a.md', '# a');
      await writeFileAt(clonePath, 'specs/b.md', '# b');
      const { service, fakeRepo } = makeService({
        repos: [{ id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath }],
      });

      await service.setAgentContext('ws-1', 'agent-1', [{ repo_id: 'r1', path: 'specs/a.md' }]);
      const beforeAdd = await fakeRepo.getAttachment({ agentId: 'agent-1' }, 'r1', 'specs/a.md');

      // Drift 'a.md' on disk (attached hash now stale) before adding 'b.md'.
      await writeFileAt(clonePath, 'specs/a.md', '# a, drifted');

      await service.setAgentContext('ws-1', 'agent-1', [
        { repo_id: 'r1', path: 'specs/a.md' },
        { repo_id: 'r1', path: 'specs/b.md' },
      ]);
      const afterAdd = await fakeRepo.getAttachment({ agentId: 'agent-1' }, 'r1', 'specs/a.md');

      // The already-attached doc's recorded hash must stay exactly what it
      // was at ITS attach time, not silently re-stamped to the new content.
      expect(afterAdd?.attachedHash).toBe(beforeAdd?.attachedHash);
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });
});

describe('ProjectContextService.drift', () => {
  it('degrades to previous_unavailable when the attached revision no longer resolves (AC-38)', async () => {
    const clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-pc-drift-'));
    try {
      await writeFileAt(clonePath, 'specs/a.md', '# current content');
      const git = new MockGitClient({}); // readFileAt rejects on any ref/path miss
      const { service, fakeRepo } = makeService({
        repos: [{ id: 'r1', workspaceId: 'ws-1', owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', clonePath }],
        git,
      });
      await fakeRepo.replaceAttachments(
        { agentId: 'agent-1' },
        [{ repoId: 'r1', path: 'specs/a.md', attachedHash: 'h', attachedSize: 1, attachedRevision: 'gone-sha' }],
      );

      const result = await service.drift({ agentId: 'agent-1' }, 'r1', 'specs/a.md');

      expect(result.previous_unavailable).toBe(true);
      expect(result.previous).toBeUndefined();
      expect(result.current).toBe('# current content');
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });
});
