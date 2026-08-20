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
import type { ProjectContextRef } from '@devdigest/shared';

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
    //
    // `db` here is a minimal chain-stub (not `{}`) because
    // `SkillsService.update` now reads the skill's CURRENT attachment set
    // (`projectContext.skillContext`, Finding 3's rollback snapshot) BEFORE
    // calling `setSkillContext` — that benign read must resolve to `[]`
    // rather than throwing a TypeError, so the assertion below stays about
    // the workspace check, not an unrelated stub gap.
    const pcContainer = {
      db: { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }) },
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

/**
 * Finding 3 (pre-PR gate, medium): `setSkillContext` persisted the new
 * attachment set in its OWN transaction before `repo.update` ran its
 * SEPARATE transaction — if `repo.update` failed, the skill kept the new
 * attachments with no matching version bump/snapshot, the exact split state
 * `SkillsRepository.update`'s own comment says the single transaction exists
 * to prevent (just one repository away from where it actually happens). Fix:
 * `SkillsService.update` snapshots the CURRENT attachment refs before
 * overwriting them and, if `repo.update` throws or returns `undefined`,
 * replays `setSkillContext` with that snapshot — a full delete-then-insert,
 * so no row from the failed new set survives.
 *
 * `container.projectContext` is a fully fake, in-memory-backed object here
 * (not the real `ProjectContextService`) so the test can assert directly on
 * the persisted attachment set across the failure/rollback, without a DB.
 */
describe('SkillsService.update — attachment rollback on a failing repo.update (Finding 3 regression)', () => {
  function fakeProjectContext(initial: ProjectContextRef[]) {
    let store = initial;
    const setSkillContext = vi.fn(async (_workspaceId: string, _id: string, refs: ProjectContextRef[]) => {
      store = refs;
    });
    const skillContext = vi.fn(async () =>
      store.map((r, i) => ({
        repo_id: r.repo_id,
        path: r.path,
        order: i,
        attached_hash: 'h',
        attached_size: 1,
        attached_revision: 'rev',
      })),
    );
    return {
      setSkillContext,
      skillContext,
      getStore: () => store,
    };
  }

  it('a throwing repo.update is rolled back to the prior attachment set — no orphaned new-set rows', async () => {
    const original: ProjectContextRef[] = [{ repo_id: 'repo-1', path: 'docs/old.md' }];
    const projectContext = fakeProjectContext(original);

    const boom = new Error('db unavailable');
    const skillsDb = {
      select: () => ({ from: () => ({ where: async () => [makeSkillRow()] }) }),
      transaction: vi.fn(async () => {
        throw boom;
      }),
    };
    const container = { db: skillsDb, projectContext } as unknown as Container;
    const service = new SkillsService(container);

    const attempted: ProjectContextRef[] = [{ repo_id: 'repo-1', path: 'docs/new.md' }];
    await expect(
      service.update(CALLER_WORKSPACE, SKILL_ID, { context: attempted }),
    ).rejects.toThrow(boom);

    // setSkillContext ran twice: once with the (now-failed) new set, once to
    // restore the original — and the FINAL persisted state is the original
    // set, not the failed attempt.
    expect(projectContext.setSkillContext).toHaveBeenCalledTimes(2);
    expect(projectContext.setSkillContext).toHaveBeenNthCalledWith(1, CALLER_WORKSPACE, SKILL_ID, attempted);
    expect(projectContext.setSkillContext).toHaveBeenNthCalledWith(2, CALLER_WORKSPACE, SKILL_ID, original);
    expect(projectContext.getStore()).toEqual(original);
  });

  it('repo.update returning undefined (skill deleted mid-flight) is also rolled back', async () => {
    const original: ProjectContextRef[] = [{ repo_id: 'repo-1', path: 'docs/old.md' }];
    const projectContext = fakeProjectContext(original);

    // `repo.update`'s own transaction re-checks existence and finds nothing —
    // simulated directly, since driving the real drizzle query builder to
    // that branch would need a much heavier fake.
    const skillsDb = {
      select: () => ({ from: () => ({ where: async () => [makeSkillRow()] }) }),
      transaction: vi.fn(async () => undefined),
    };
    const container = { db: skillsDb, projectContext } as unknown as Container;
    const service = new SkillsService(container);

    const attempted: ProjectContextRef[] = [{ repo_id: 'repo-1', path: 'docs/new.md' }];
    await expect(
      service.update(CALLER_WORKSPACE, SKILL_ID, { context: attempted }),
    ).resolves.toBeUndefined();

    expect(projectContext.setSkillContext).toHaveBeenCalledTimes(2);
    expect(projectContext.getStore()).toEqual(original);
  });
});
