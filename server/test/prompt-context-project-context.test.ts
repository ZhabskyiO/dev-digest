/**
 * T15 — `resolveProjectContext` (server/src/modules/reviews/prompt-context.ts).
 *
 * Hermetic: no DB, no Docker, no network. `container` is a plain object cast
 * to `Container` (same pattern as `repo-intel-resync.test.ts`) exposing only
 * the pieces the function actually touches — `config`, `projectContext`,
 * `reviewRepo`, `projectContextRepo`. Real filesystem I/O happens against a
 * throwaway temp directory standing in for a repo clone.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { resolveProjectContext, type StepLog } from '../src/modules/reviews/prompt-context.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import type { EffectiveProjectContext, EffectiveProjectContextDoc } from '@devdigest/shared';

const AGENT_ID = 'agent-1';
const REPO_ID = 'repo-1';
const OTHER_REPO_ID = 'repo-2';

const log: StepLog = { info: () => {} };

function doc(overrides: Partial<EffectiveProjectContextDoc> = {}): EffectiveProjectContextDoc {
  return {
    repo_id: REPO_ID,
    path: 'specs/a.md',
    type: 'specs',
    tokens: 10,
    source: 'agent',
    ...overrides,
  };
}

function effective(documents: EffectiveProjectContextDoc[]): EffectiveProjectContext {
  const total = documents.reduce((sum, d) => sum + d.tokens, 0);
  return {
    documents,
    total_tokens: total,
    budget_tokens: 12_000,
    over_budget: false,
    dropped_paths: [],
  };
}

interface FakeContainerOptions {
  documents: EffectiveProjectContextDoc[];
  clonePath?: string | null;
  attachedHash?: string;
  docCharCap?: number;
  budgetTokens?: number;
  llm?: MockLLMProvider;
}

function fakeContainer(opts: FakeContainerOptions): Container {
  return {
    config: {
      projectContextDocCharCap: opts.docCharCap ?? 1_000_000,
      projectContextBudgetTokens: opts.budgetTokens ?? 12_000,
    },
    projectContext: {
      effectiveContext: async (agentId: string) => {
        expect(agentId).toBe(AGENT_ID);
        return effective(opts.documents);
      },
    },
    reviewRepo: {
      getRepo: async (repoId: string) => {
        if (repoId !== REPO_ID) return undefined;
        if (opts.clonePath === null) return { id: repoId, clonePath: null };
        return { id: repoId, clonePath: opts.clonePath };
      },
    },
    projectContextRepo: {
      getAttachment: async () =>
        opts.attachedHash === undefined ? undefined : { attachedHash: opts.attachedHash },
    },
    llm: opts.llm,
  } as unknown as Container;
}

describe('resolveProjectContext (T15)', () => {
  let clone: string;

  beforeEach(async () => {
    clone = await mkdtemp(path.join(tmpdir(), 'pc-clone-'));
    await mkdir(path.join(clone, 'specs'), { recursive: true });
  });

  afterEach(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  it('AC-26: empty effective set returns {bodies: [], specsRead: [], details: []}, prompt unchanged', async () => {
    const container = fakeContainer({ documents: [] });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result).toEqual({ bodies: [], specsRead: [], details: [] });

    // A stubbed prompt assembly receives no `specs` key at all — the
    // assembled prompt stays byte-identical to the no-attachments shape.
    const withSpecs = assemblePrompt({
      system: 'sys',
      diff: 'D',
      ...(result.bodies.length > 0 ? { specs: result.bodies } : {}),
    });
    const withoutSpecs = assemblePrompt({ system: 'sys', diff: 'D' });
    expect(withSpecs.messages[1]!.content).toBe(withoutSpecs.messages[1]!.content);
    expect(withSpecs.messages[1]!.content).not.toContain('## Project context');
  });

  it('AC-22: a deleted attached file is recorded missing and omitted from bodies', async () => {
    // Never written to disk — simulates "deleted between attach and run".
    const container = fakeContainer({
      documents: [doc({ path: 'specs/gone.md' })],
      clonePath: clone,
    });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([]);
    expect(result.specsRead).toEqual([]);
    expect(result.details).toEqual([{ path: 'specs/gone.md', tokens: 10, outcome: 'missing' }]);
  });

  it('AC-24: a document over the char cap is truncated and flagged', async () => {
    const big = 'x'.repeat(200_000);
    await writeFile(path.join(clone, 'specs', 'big.md'), big, 'utf8');
    const container = fakeContainer({
      documents: [doc({ path: 'specs/big.md' })],
      clonePath: clone,
      docCharCap: 500,
    });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([big.slice(0, 500)]);
    expect(result.bodies[0]!.length).toBe(500);
    expect(result.details).toEqual([
      { path: 'specs/big.md', tokens: 10, outcome: 'truncated', truncated: true },
    ]);
  });

  it('AC-25: an attachment from another repo is recorded wrong_repo and injects nothing', async () => {
    const container = fakeContainer({
      documents: [doc({ repo_id: OTHER_REPO_ID, path: 'specs/other.md' })],
      clonePath: clone,
    });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([]);
    expect(result.details).toEqual([
      { path: 'specs/other.md', tokens: 10, outcome: 'wrong_repo' },
    ]);
  });

  it('AC-25 (local review): no repoId at all means every attachment is wrong_repo', async () => {
    const container = fakeContainer({ documents: [doc()], clonePath: clone });
    const result = await resolveProjectContext(container, AGENT_ID, undefined, log);
    expect(result.bodies).toEqual([]);
    expect(result.details).toEqual([{ path: 'specs/a.md', tokens: 10, outcome: 'wrong_repo' }]);
  });

  it('AC-44: an edited-but-unconfirmed document injects the NEW bytes and is flagged changed_unconfirmed', async () => {
    await writeFile(path.join(clone, 'specs', 'a.md'), 'new content', 'utf8');
    const container = fakeContainer({
      documents: [doc()],
      clonePath: clone,
      // attached_hash recorded at attach time — deliberately stale, so the
      // hash of the content just read differs from it.
      attachedHash: 'deadbeef',
    });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual(['new content']);
    expect(result.specsRead).toEqual(['specs/a.md']);
    expect(result.details).toEqual([
      { path: 'specs/a.md', tokens: 10, outcome: 'changed_unconfirmed', changed: true },
    ]);
  });

  it('unconfirmed document that matches its attached hash injects plainly (no changed flag)', async () => {
    const { createHash } = await import('node:crypto');
    const content = 'stable content';
    await writeFile(path.join(clone, 'specs', 'a.md'), content, 'utf8');
    const hash = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
    const container = fakeContainer({ documents: [doc()], clonePath: clone, attachedHash: hash });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([content]);
    expect(result.details).toEqual([{ path: 'specs/a.md', tokens: 10, outcome: 'injected' }]);
  });

  it('AC-23: budget cuts off the second document and everything after it, in order', async () => {
    await writeFile(path.join(clone, 'specs', 'a.md'), 'body-a', 'utf8');
    await writeFile(path.join(clone, 'specs', 'b.md'), 'body-b', 'utf8');
    await writeFile(path.join(clone, 'specs', 'c.md'), 'body-c', 'utf8');
    const container = fakeContainer({
      documents: [
        doc({ path: 'specs/a.md', tokens: 5 }),
        doc({ path: 'specs/b.md', tokens: 6 }), // 5 + 6 = 11 > budget(10)
        doc({ path: 'specs/c.md', tokens: 1 }),
      ],
      clonePath: clone,
      budgetTokens: 10,
    });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual(['body-a']);
    expect(result.specsRead).toEqual(['specs/a.md']);
    expect(result.details).toEqual([
      { path: 'specs/a.md', tokens: 5, outcome: 'injected' },
      { path: 'specs/b.md', tokens: 6, outcome: 'dropped_over_budget' },
      { path: 'specs/c.md', tokens: 1, outcome: 'dropped_over_budget' },
    ]);
  });

  it('AC-27: assembling project context issues zero LLM provider calls', async () => {
    await writeFile(path.join(clone, 'specs', 'a.md'), 'content', 'utf8');
    const llm = new MockLLMProvider();
    const container = fakeContainer({ documents: [doc()], clonePath: clone, llm });
    await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(llm.calls).toEqual([]);
  });

  it('degrades to empty on an unexpected throw (never fails the run)', async () => {
    const container = {
      config: { projectContextDocCharCap: 1000, projectContextBudgetTokens: 1000 },
      projectContext: {
        effectiveContext: async () => {
          throw new Error('boom');
        },
      },
    } as unknown as Container;
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result).toEqual({ bodies: [], specsRead: [], details: [] });
  });

  it('repo not cloned (clonePath null) records every candidate as missing', async () => {
    const container = fakeContainer({ documents: [doc()], clonePath: null });
    const result = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(result.bodies).toEqual([]);
    expect(result.details).toEqual([{ path: 'specs/a.md', tokens: 10, outcome: 'missing' }]);
  });
});
