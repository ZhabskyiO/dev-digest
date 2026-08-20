/**
 * T18 — local review wiring for project context (AC-28).
 *
 * Hermetic: no DB, no Docker, no network. `container` is a plain object cast
 * to `Container` (same pattern as `test/prompt-context-project-context.test.ts`
 * and `test/repo-intel-resync.test.ts`) — only `LocalReviewService` and
 * `resolveProjectContext` actually touch it. `db` is faked with just enough of
 * the drizzle `.select().from().where()` chain for
 * `ReviewRepository.getRepoByFullName`, the one query `LocalReviewService`
 * itself issues.
 *
 * The point: `local-review.ts` must call the SAME `resolveProjectContext` the
 * PR path (`run-executor.ts`) calls, with the `repoId` it resolves from
 * `req.repo` — not a parallel re-implementation. Proven here by calling
 * `resolveProjectContext` directly (standing in for the PR path) against the
 * identical fake container and asserting the `## Project context` section the
 * local review actually sent the model is byte-identical to what that call
 * produces through `assemblePrompt`.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { LocalReviewService } from '../src/modules/reviews/local-review.js';
import { resolveProjectContext, type StepLog } from '../src/modules/reviews/prompt-context.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import type {
  EffectiveProjectContext,
  EffectiveProjectContextDoc,
  Review,
} from '@devdigest/shared';

const WORKSPACE_ID = 'ws-1';
const AGENT_ID = 'agent-1';
const REPO_ID = 'repo-1';

const log: StepLog = { info: () => {} };

/** A single-file working-tree diff, same shape `git diff HEAD` emits. */
const WORKING_DIFF = `diff --git a/src/config.ts b/src/config.ts
index ce01362..9a7a4b5 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
`;

/** No findings — this test is about the prompt, not the grounding gate. */
const REVIEW_FIXTURE: Review = { verdict: 'approve', summary: 'looks fine', score: 95, findings: [] };

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

/** Just enough of `AgentRow` for `LocalReviewService.review` to run. */
function agentRow() {
  return {
    id: AGENT_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Reviewer',
    description: '',
    provider: 'openai' as const,
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    strategy: 'single-pass' as const,
    ciFailOn: 'critical' as const,
    // Off, so the enrichment (callers/repo-map/rank note) builders — out of
    // this task's scope — never fire; only project context is under test.
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
  };
}

interface FakeContainerOptions {
  documents: EffectiveProjectContextDoc[];
  clonePath: string | null;
  /** Row `getRepoByFullName` resolves to, or `undefined` for "not imported". */
  repoRow?: { id: string };
  llm: MockLLMProvider;
}

/** `db.select().from(...).where(...)` stub — the only query `LocalReviewService`
 *  itself issues (`ReviewRepository.getRepoByFullName`). Args are ignored;
 *  it always resolves to the fixed row the test configured. */
function fakeDb(row: { id: string } | undefined) {
  return {
    select: () => ({
      from: () => ({
        where: async () => (row ? [row] : []),
      }),
    }),
  };
}

function fakeContainer(opts: FakeContainerOptions): Container {
  return {
    db: fakeDb(opts.repoRow),
    config: {
      projectContextDocCharCap: 1_000_000,
      projectContextBudgetTokens: 12_000,
    },
    agentsRepo: {
      getById: async (workspaceId: string, agentId: string) => {
        expect(workspaceId).toBe(WORKSPACE_ID);
        expect(agentId).toBe(AGENT_ID);
        return agentRow();
      },
      linkedSkills: async () => [],
    },
    reviewRepo: {
      getRepo: async (repoId: string) =>
        repoId === REPO_ID ? { id: REPO_ID, clonePath: opts.clonePath } : undefined,
    },
    projectContext: {
      effectiveContext: async (agentId: string) => {
        expect(agentId).toBe(AGENT_ID);
        return effective(opts.documents);
      },
    },
    projectContextRepo: {
      // No prior attachment recorded — every candidate reads as freshly
      // attached (`injected`, never `changed_unconfirmed`).
      getAttachment: async () => undefined,
    },
    llm: async () => opts.llm,
  } as unknown as Container;
}

/** The raw body of a `## <heading>\n...` section out of an assembled user
 *  message — sections are joined with `\n\n## `, same split `assemblePrompt`
 *  uses to join `userSections`. */
function extractSection(userMessage: string, heading: string): string | undefined {
  const marker = `## ${heading}\n`;
  const start = userMessage.indexOf(marker);
  if (start === -1) return undefined;
  const bodyStart = start + marker.length;
  const nextHeading = userMessage.indexOf('\n\n## ', bodyStart);
  return nextHeading === -1 ? userMessage.slice(bodyStart) : userMessage.slice(bodyStart, nextHeading);
}

describe('LocalReviewService — project context wiring (T18, AC-28)', () => {
  let clone: string;

  beforeEach(async () => {
    clone = await mkdtemp(path.join(tmpdir(), 'local-review-pc-'));
    await mkdir(path.join(clone, 'specs'), { recursive: true });
    await writeFile(path.join(clone, 'specs', 'a.md'), 'Follow the house style.', 'utf8');
  });

  afterEach(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  it('AC-28: a local review on the same repo injects the identical `## Project context` section the PR path would build', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = fakeContainer({
      documents: [doc()],
      clonePath: clone,
      repoRow: { id: REPO_ID },
      llm,
    });

    // The PR path: the same `resolveProjectContext` (`run-executor.ts` calls
    // it identically), against the SAME container, for the SAME agent+repo.
    const prPath = await resolveProjectContext(container, AGENT_ID, REPO_ID, log);
    expect(prPath.bodies).toEqual(['Follow the house style.']);
    const prAssembly = assemblePrompt({
      system: 'irrelevant for this comparison',
      diff: 'irrelevant',
      specs: prPath.bodies,
    });

    const service = new LocalReviewService(container);
    const result = await service.review(WORKSPACE_ID, {
      mode: 'working',
      diff: WORKING_DIFF,
      agentId: AGENT_ID,
      repo: 'org/repo',
    });

    // `repoIntel: false` degrades the (unrelated) callers/repo-map builders —
    // expected, and orthogonal to project context, which is what's under test.
    expect(result.degraded.some((d) => d.includes('project-context'))).toBe(false);
    expect(llm.calls).toHaveLength(1);
    const sent = llm.calls[0]!.req as { messages: { role: string; content: string }[] };
    const userMessage = sent.messages.find((m) => m.role === 'user')!.content;

    const actualSection = extractSection(userMessage, 'Project context');
    const expectedSection = extractSection(
      `## Project context\n${prAssembly.assembly.specs}`,
      'Project context',
    );
    expect(actualSection).toBeDefined();
    expect(actualSection).toBe(expectedSection);
  });

  it('omitting `req.repo` injects nothing and records a degraded entry, not a silent drop', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = fakeContainer({
      documents: [doc()],
      clonePath: clone,
      // No repoRow at all — irrelevant here since `req.repo` is never sent,
      // so `getRepoByFullName` is never even called.
      llm,
    });

    const service = new LocalReviewService(container);
    const result = await service.review(WORKSPACE_ID, {
      mode: 'working',
      diff: WORKING_DIFF,
      agentId: AGENT_ID,
    });

    expect(result.degraded.some((d) => d.includes('no repo given'))).toBe(true);
    expect(
      result.degraded.some((d) => d.includes('project-context attachment') && d.includes('skipped')),
    ).toBe(true);

    expect(llm.calls).toHaveLength(1);
    const sent = llm.calls[0]!.req as { messages: { role: string; content: string }[] };
    const userMessage = sent.messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).not.toContain('## Project context');
  });
});
