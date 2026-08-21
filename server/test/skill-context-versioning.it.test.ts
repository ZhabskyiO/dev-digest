import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skill-context-versioning] Docker not available — skipping integration tests.');
}

/**
 * T16 — skill attachment versioning (AC-13, AC-39, AC-42). `PATCH
 * /skills/:id` (registered as `PUT` — see `modules/skills/routes.ts`)
 * accepts an optional ordered `context` array; the repository's update path
 * must append EXACTLY ONE `skill_versions` row when the body changed, when
 * the attachment set changed, or when both changed together in one save —
 * and NONE when neither changed.
 */
d('skill attachment versioning', () => {
  let pg: PgFixture;
  let clonePath: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    clonePath = await mkdtemp(path.join(tmpdir(), 'devdigest-skill-context-'));
    await mkdir(path.join(clonePath, 'docs'), { recursive: true });
    await writeFile(path.join(clonePath, 'docs', 'a.md'), '# Doc A');
    await writeFile(path.join(clonePath, 'docs', 'b.md'), '# Doc B');

    const [{ id: workspaceId }] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    const [repoRow] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: workspaceId!,
        owner: 'acme',
        name: 'skill-context-fixture',
        fullName: 'acme/skill-context-fixture',
        clonePath,
      })
      .returning();
    repoId = repoRow!.id;

    /* The two docs written to the clone above must ALSO exist as discovered
       `project_context_documents` rows. `buildAttachmentRows` gates every ref
       on `getDocument(repo_id, path)` and SKIPS a ref that resolves to no
       discovered document — deliberately, so a path that merely survives
       `resolveInClone`'s containment check (`.git/config`) can never be
       attached. That skip is silent ("degrade, never block"), so without these
       rows a PUT still answers 200 while persisting no attachment at all, and
       only a test that reads the attachment rows back can see it. */
    await pg.handle.db.insert(t.projectContextDocuments).values(
      ['docs/a.md', 'docs/b.md'].map((p) => ({
        repoId,
        path: p,
        type: 'docs' as const,
        sizeBytes: 7,
        contentHash: `seed-${p}`,
        tokens: 3,
      })),
    );
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ head: 'sha-fixture' }), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'Context-Versioned Skill',
    description: 'Exercises attachment versioning.',
    type: 'custom' as const,
    body: '# Rule\n\nOriginal body.',
  };

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>) {
    const created = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    return created.json() as { id: string };
  }

  async function getVersions(app: Awaited<ReturnType<typeof makeApp>>, skillId: string) {
    const res = await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` });
    return res.json() as Array<{
      version: number;
      body: string;
      attachments: { repo_id: string; path: string }[] | null;
    }>;
  }

  it('changing only the attachment set appends exactly one version whose attachments match the new ordered list (AC-39)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(2);

    const versions = await getVersions(app, skill.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]?.attachments).toEqual([{ repo_id: repoId, path: 'docs/a.md' }]);
    // The body itself didn't change — v2's snapshot still carries it, unbumped.
    expect(versions[0]?.body).toBe(createBody.body);
    // v1 predates attachments for this skill (created before any context was
    // ever set) and has none.
    expect(versions[1]?.attachments == null || versions[1]?.attachments.length === 0).toBe(true);

    await app.close();
  });

  it('editing only the body appends exactly one version (AC-42) and carries the last attachment list forward', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    // First attach a document (v2).
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });

    // Then a body-only edit (v3) — must NOT reset the attachment list.
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rule\n\nUpdated body.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(3);

    const versions = await getVersions(app, skill.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]?.body).toBe('# Rule\n\nUpdated body.');
    expect(versions[0]?.attachments).toEqual([{ repo_id: repoId, path: 'docs/a.md' }]);

    await app.close();
  });

  it('changing both body and attachments in one PUT appends exactly one version carrying both (AC-42)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });
    const versionsBefore = await getVersions(app, skill.id);
    expect(versionsBefore).toHaveLength(2);

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: {
        body: '# Rule\n\nBoth changed at once.',
        context: [
          { repo_id: repoId, path: 'docs/a.md' },
          { repo_id: repoId, path: 'docs/b.md' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(3);

    const versions = await getVersions(app, skill.id);
    // Exactly one new row — not two — for a single save touching both fields.
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]?.body).toBe('# Rule\n\nBoth changed at once.');
    expect(versions[0]?.attachments).toEqual([
      { repo_id: repoId, path: 'docs/a.md' },
      { repo_id: repoId, path: 'docs/b.md' },
    ]);

    await app.close();
  });

  it('saving with neither body nor attachments changed appends no version (AC-42)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });
    const versionsBefore = await getVersions(app, skill.id);
    expect(versionsBefore).toHaveLength(2);

    // Re-send the SAME ordered context plus an unrelated field (name) — no
    // real change to body or attachment set.
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { name: 'Renamed, no version', context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(2);

    const versionsAfter = await getVersions(app, skill.id);
    expect(versionsAfter).toHaveLength(2);
    expect(versionsAfter.map((v) => v.version)).toEqual([2, 1]);

    await app.close();
  });

  it('reordering the same attachment set counts as a change (order-sensitive) and bumps the version', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: {
        context: [
          { repo_id: repoId, path: 'docs/a.md' },
          { repo_id: repoId, path: 'docs/b.md' },
        ],
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: {
        context: [
          { repo_id: repoId, path: 'docs/b.md' },
          { repo_id: repoId, path: 'docs/a.md' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(3);

    const versions = await getVersions(app, skill.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]?.attachments).toEqual([
      { repo_id: repoId, path: 'docs/b.md' },
      { repo_id: repoId, path: 'docs/a.md' },
    ]);

    await app.close();
  });

  it("the appended row's version equals skills.version after the bump (AC-39)", async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });
    expect(res.statusCode).toBe(200);
    const updatedSkill = res.json();

    const versions = await getVersions(app, skill.id);
    expect(versions[0]?.version).toBe(updatedSkill.version);

    await app.close();
  });

  it('rejects a context ref pointing at a repo in a foreign workspace, and persists nothing (CRITICAL 1 regression)', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace' })
      .returning();
    const [foreignRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWorkspace!.id,
        owner: 'acme',
        name: 'foreign-repo',
        fullName: 'acme/foreign-repo',
        clonePath,
      })
      .returning();

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: foreignRepo!.id, path: 'docs/a.md' }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    // Nothing persisted: no new version, and the (empty) attachment set is unchanged.
    const versions = await getVersions(app, skill.id);
    expect(versions).toHaveLength(1);
    const contextRes = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context` });
    expect(contextRes.json()).toEqual([]);

    await app.close();
  });

  it('the actual attachment rows are persisted (readable via GET /skills/:id/context), not just the version snapshot', async () => {
    const app = await makeApp();
    const skill = await createSkill(app);

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { context: [{ repo_id: repoId, path: 'docs/a.md' }] },
    });

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context` });
    expect(res.statusCode).toBe(200);
    const attachments = res.json() as { repo_id: string; path: string; order: number }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ repo_id: repoId, path: 'docs/a.md', order: 0 });

    await app.close();
  });
});
