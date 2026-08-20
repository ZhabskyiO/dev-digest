/**
 * Regression test for the self-review CRITICAL 1 finding: `PUT /skills/:id`
 * (`SkillsService.update`) accepted `context: ProjectContextRef[]` and forwarded
 * it straight to `container.projectContext.setSkillContext` without checking
 * that each ref's `repo_id` belongs to the caller's workspace — a skill in
 * workspace A could attach (and, via `GET /skills/:id/context`, read back) a
 * document's hash/size/HEAD-sha out of workspace B's repo clone.
 *
 * The fix moved the check into `ProjectContextService.setSkillContext` (and
 * `setAgentContext`) itself, so this test wires the REAL `ProjectContextService`
 * (not a stub) behind `SkillsService` — a stubbed `setSkillContext` would only
 * prove `SkillsService` propagates whatever it's told, not that the workspace
 * check actually runs.
 *
 * Hermetic — no DB. `SkillsService` constructs its own `SkillsRepository`
 * directly from `container.db` (never `container.skillsRepo`, see
 * `server/insights/INSIGHTS.md`'s `LocalReviewService` entry for the same shape), so a
 * minimal chain-stub for the one query `getById` issues is enough; `db.transaction`
 * is a spy so "persists nothing" can be asserted directly rather than inferred.
 */
import { describe, it, expect, vi } from 'vitest';
import { SkillsService } from '../src/modules/skills/service.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { SkillRow } from '../src/modules/skills/repository.js';

const CALLER_WORKSPACE = 'ws-1';
const OTHER_WORKSPACE = 'ws-OTHER';
const SKILL_ID = 'skill-1';
const FOREIGN_REPO_ID = 'repo-in-other-workspace';

function makeSkillRow(): SkillRow {
  return {
    id: SKILL_ID,
    workspaceId: CALLER_WORKSPACE,
    name: 'Test skill',
    description: '',
    type: 'custom',
    source: 'manual',
    body: '# body',
    enabled: true,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SkillRow;
}

describe('SkillsService.update — cross-tenant project-context ref (CRITICAL 1 regression)', () => {
  it('rejects a context ref whose repo_id belongs to a foreign workspace, and persists nothing', async () => {
    const dbTransaction = vi.fn();
    const skillsDb = {
      select: () => ({
        from: () => ({
          where: async () => [makeSkillRow()],
        }),
      }),
      transaction: dbTransaction,
    };

    // The REAL ProjectContextService, so its own `assertRefsInWorkspace` gate
    // is what's actually exercised — a fake `container.reviewRepo.getRepo`
    // reports the referenced repo as belonging to a DIFFERENT workspace.
    const pcContainer = {
      db: {}, // never touched: the throw happens before any repo query
      reviewRepo: {
        getRepo: async (id: string) =>
          id === FOREIGN_REPO_ID
            ? { id: FOREIGN_REPO_ID, workspaceId: OTHER_WORKSPACE, clonePath: null }
            : undefined,
      },
    } as unknown as Container;
    const projectContext = new ProjectContextService(pcContainer);

    const container = {
      db: skillsDb,
      projectContext,
    } as unknown as Container;

    const service = new SkillsService(container);

    await expect(
      service.update(CALLER_WORKSPACE, SKILL_ID, {
        context: [{ repo_id: FOREIGN_REPO_ID, path: 'docs/secret.md' }],
      }),
    ).rejects.toThrow(NotFoundError);

    // Nothing was written to `skills`/`skill_versions` — the rejection
    // happened before `SkillsRepository.update` (and its `db.transaction`)
    // was ever reached.
    expect(dbTransaction).not.toHaveBeenCalled();
  });

  it('still allows a context ref whose repo_id belongs to the caller workspace (no false positive)', async () => {
    // Exercised directly against `ProjectContextService.setSkillContext` — the
    // method the CRITICAL 1 fix actually gates — rather than the full
    // `SkillsService.update` chain, which would otherwise require faking
    // `SkillsRepository.update`'s drizzle transaction just to reach this
    // assertion. Same fake-repository cast pattern as
    // `test/project-context-service.test.ts`.
    const pcContainer = {
      db: {},
      reviewRepo: {
        getRepo: async (id: string) =>
          id === 'own-repo'
            ? { id: 'own-repo', workspaceId: CALLER_WORKSPACE, clonePath: null }
            : undefined,
      },
    } as unknown as Container;
    const projectContext = new ProjectContextService(pcContainer);
    const replaceAttachments = vi.fn(async () => undefined);
    (projectContext as unknown as { repo: Record<string, unknown> }).repo = {
      listAttachments: async () => [],
      replaceAttachments,
      // `buildAttachmentRows` now requires the ref's path to resolve as a
      // discovered document before it will attach it (PAT-disclosure fix,
      // see `project-context/service.ts`) — this stub reports it as one.
      getDocument: async () => ({ id: 'doc-1', repoId: 'own-repo', path: 'docs/a.md' }),
    };

    await expect(
      projectContext.setSkillContext(CALLER_WORKSPACE, SKILL_ID, [
        { repo_id: 'own-repo', path: 'docs/a.md' },
      ]),
    ).resolves.toBeUndefined();
    expect(replaceAttachments).toHaveBeenCalledTimes(1);
  });
});
