/**
 * `resolveInClone` (`server/src/modules/_shared/clone-path-guard.ts`) — the
 * single shared symlink-escape containment guard used by BOTH
 * `ProjectContextService` (`modules/project-context/service.ts`) and
 * `resolveProjectContext` (`modules/reviews/prompt-context.ts`). Originally
 * promoted out of two separately-maintained copies into
 * `modules/project-context/path-guard.ts` (architecture finding: duplicated
 * untrusted-input containment guard), then relocated again into
 * `modules/_shared/` (a later architecture-review finding: a module reaching
 * into another module's internal file) — this test proves the guard itself,
 * plus that both call sites still reject through it.
 *
 * Hermetic: real filesystem, throwaway temp directories, no DB, no Docker.
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInClone } from '../src/modules/_shared/clone-path-guard.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { resolveProjectContext, type StepLog } from '../src/modules/reviews/prompt-context.js';
import type { Container } from '../src/platform/container.js';
import type {
  ContextAttachmentRow,
  ProjectContextDocumentRow,
  ProjectContextRepository,
} from '../src/modules/project-context/repository.js';
import type { EffectiveProjectContext, EffectiveProjectContextDoc } from '@devdigest/shared';

const log: StepLog = { info: () => {} };

describe('resolveInClone (path-guard, shared guard)', () => {
  let root: string;
  let realRoot: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pg-root-'));
    outside = await mkdtemp(path.join(tmpdir(), 'pg-outside-'));
    realRoot = await realpath(root);
    await mkdir(path.join(root, 'specs'), { recursive: true });
    await writeFile(path.join(root, 'specs', 'a.md'), 'inside content', 'utf8');
    await writeFile(path.join(outside, 'secret.md'), 'outside content', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('accepts a plain in-root relative path', async () => {
    const real = await resolveInClone(realRoot, 'specs/a.md');
    expect(real).not.toBeNull();
  });

  it('rejects an absolute path escape', async () => {
    const real = await resolveInClone(realRoot, path.join(outside, 'secret.md'));
    expect(real).toBeNull();
  });

  it('rejects a ".." traversal', async () => {
    const real = await resolveInClone(realRoot, '../outside/secret.md');
    expect(real).toBeNull();
  });

  it('rejects a symlink whose real target escapes the root', async () => {
    await symlink(path.join(outside, 'secret.md'), path.join(root, 'specs', 'escape.md'));
    const real = await resolveInClone(realRoot, 'specs/escape.md');
    expect(real).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Both call sites still reject through the shared guard.
// ---------------------------------------------------------------------------

describe('ProjectContextService.preview delegates to the shared guard', () => {
  let clonePath: string;
  let outside: string;

  class FakeProjectContextRepository {
    documents = new Map<string, ProjectContextDocumentRow>();

    async getDocument(repoId: string, docPath: string): Promise<ProjectContextDocumentRow | undefined> {
      return this.documents.get(`${repoId} ${docPath}`);
    }
    async usedByAgentCounts(): Promise<Map<string, number>> {
      return new Map();
    }
    async driftedPaths(): Promise<string[]> {
      return [];
    }
    // Unused by preview() — present only to satisfy the type.
    async listDocuments(): Promise<ProjectContextDocumentRow[]> {
      return [];
    }
    async upsertDocuments(): Promise<void> {}
    async deleteMissing(): Promise<void> {}
    async listAttachments(): Promise<ContextAttachmentRow[]> {
      return [];
    }
    async getAttachment(): Promise<ContextAttachmentRow | undefined> {
      return undefined;
    }
    async replaceAttachments(): Promise<void> {}
    async updateAttachedHash(): Promise<void> {}
  }

  beforeEach(async () => {
    clonePath = await mkdtemp(path.join(tmpdir(), 'pg-service-clone-'));
    outside = await mkdtemp(path.join(tmpdir(), 'pg-service-outside-'));
    await mkdir(path.join(clonePath, 'specs'), { recursive: true });
    await writeFile(path.join(outside, 'secret.md'), 'secret', 'utf8');
  });

  afterEach(async () => {
    await rm(clonePath, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  function makeService(fakeRepo: FakeProjectContextRepository) {
    const container = {
      db: {},
      config: {
        projectContextPreviewChars: 4000,
      },
      reviewRepo: {
        getRepo: async (id: string) => ({ id, workspaceId: 'ws-1', clonePath }),
      },
    } as unknown as Container;
    const service = new ProjectContextService(container);
    (service as unknown as { repo: ProjectContextRepository }).repo =
      fakeRepo as unknown as ProjectContextRepository;
    return service;
  }

  it('throws NotFoundError for a symlink-escape document path (never returns the outside body)', async () => {
    await symlink(path.join(outside, 'secret.md'), path.join(clonePath, 'specs', 'escape.md'));
    const fakeRepo = new FakeProjectContextRepository();
    // Simulate a stored document row for the malicious path (a scan would
    // never write this, but the containment check must not rely on that).
    fakeRepo.documents.set('r1 specs/escape.md', {
      id: 'doc-1',
      repoId: 'r1',
      path: 'specs/escape.md',
      type: 'specs',
      sizeBytes: 6,
      contentHash: 'x',
      tokens: 1,
      scannedAt: new Date(),
    } as ProjectContextDocumentRow);

    const service = makeService(fakeRepo);
    await expect(service.preview('r1', 'specs/escape.md')).rejects.toThrow('Document not found');
  });
});

describe('resolveProjectContext delegates to the shared guard', () => {
  let clonePath: string;
  let outside: string;
  const AGENT_ID = 'agent-1';
  const REPO_ID = 'repo-1';

  beforeEach(async () => {
    clonePath = await mkdtemp(path.join(tmpdir(), 'pg-prompt-clone-'));
    outside = await mkdtemp(path.join(tmpdir(), 'pg-prompt-outside-'));
    await mkdir(path.join(clonePath, 'specs'), { recursive: true });
    await writeFile(path.join(outside, 'secret.md'), 'secret', 'utf8');
  });

  afterEach(async () => {
    await rm(clonePath, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  function doc(overrides: Partial<EffectiveProjectContextDoc> = {}): EffectiveProjectContextDoc {
    return {
      repo_id: REPO_ID,
      path: 'specs/escape.md',
      type: 'specs',
      tokens: 10,
      source: 'agent',
      ...overrides,
    };
  }

  function effective(documents: EffectiveProjectContextDoc[]): EffectiveProjectContext {
    return {
      documents,
      total_tokens: documents.reduce((s, d) => s + d.tokens, 0),
      budget_tokens: 12_000,
      over_budget: false,
      dropped_paths: [],
    };
  }

  it('records a symlink-escape attachment as missing, never injects the outside body', async () => {
    await symlink(path.join(outside, 'secret.md'), path.join(clonePath, 'specs', 'escape.md'));

    const container = {
      config: { projectContextDocCharCap: 1_000_000, projectContextBudgetTokens: 12_000 },
      projectContext: { effectiveContext: async () => effective([doc()]) },
      reviewRepo: { getRepo: async () => ({ id: REPO_ID, clonePath }) },
      projectContextRepo: { getAttachment: async () => undefined },
    } as unknown as Container;

    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([]);
    expect(result.details).toEqual([{ path: 'specs/escape.md', tokens: 10, outcome: 'missing' }]);
  });

  it('records a ".." traversal attachment as missing', async () => {
    const container = {
      config: { projectContextDocCharCap: 1_000_000, projectContextBudgetTokens: 12_000 },
      projectContext: {
        effectiveContext: async () => effective([doc({ path: '../outside/secret.md' })]),
      },
      reviewRepo: { getRepo: async () => ({ id: REPO_ID, clonePath }) },
      projectContextRepo: { getAttachment: async () => undefined },
    } as unknown as Container;

    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([]);
    expect(result.details).toEqual([
      { path: '../outside/secret.md', tokens: 10, outcome: 'missing' },
    ]);
  });
});
