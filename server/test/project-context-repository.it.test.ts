import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-repository] Docker not available — skipping integration tests.');
}

/**
 * T6 — `ProjectContextRepository` data-access (AC-11, AC-14, AC-15).
 *
 * Fixtures are planted directly via `t.*` inserts rather than through a
 * service — T9 (service.ts) hasn't landed yet, and this module owns only the
 * repository. Each test uses its own repo/agent/skill/path so tests can run
 * against the same shared Postgres fixture without interfering with each
 * other.
 */
d('ProjectContextRepository', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: ProjectContextRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    repo = new ProjectContextRepository(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepo(fullName: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: fullName, fullName: `acme/${fullName}` })
      .returning();
    return row!.id;
  }

  async function makeAgent(name: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'review',
      })
      .returning();
    return row!.id;
  }

  async function makeSkill(name: string, enabled: boolean): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: '# body',
        enabled,
      })
      .returning();
    return row!.id;
  }

  describe('upsertDocuments / deleteMissing / listDocuments / getDocument', () => {
    it('inserts new documents and updates a row only when its hash changed', async () => {
      const repoId = await makeRepo('upsert-repo');

      await repo.upsertDocuments(repoId, [
        { path: 'docs/a.md', type: 'docs', sizeBytes: 10, contentHash: 'h1', tokens: 5 },
        { path: 'specs/b.md', type: 'specs', sizeBytes: 20, contentHash: 'h2', tokens: 8 },
      ]);
      let docs = await repo.listDocuments(repoId);
      expect(docs).toHaveLength(2);
      const a1 = docs.find((doc) => doc.path === 'docs/a.md')!;
      expect(a1.tokens).toBe(5);

      // Same hash, different tokens value in the payload — must NOT update
      // (the `setWhere` gate on unchanged content_hash).
      await repo.upsertDocuments(repoId, [
        { path: 'docs/a.md', type: 'docs', sizeBytes: 10, contentHash: 'h1', tokens: 999 },
      ]);
      let a2 = await repo.getDocument(repoId, 'docs/a.md');
      expect(a2!.tokens).toBe(5);

      // Changed hash — row updates.
      await repo.upsertDocuments(repoId, [
        { path: 'docs/a.md', type: 'docs', sizeBytes: 11, contentHash: 'h1-changed', tokens: 999 },
      ]);
      a2 = await repo.getDocument(repoId, 'docs/a.md');
      expect(a2!.tokens).toBe(999);
      expect(a2!.contentHash).toBe('h1-changed');
      expect(a2!.sizeBytes).toBe(11);

      docs = await repo.listDocuments(repoId);
      expect(docs.map((doc) => doc.path).sort()).toEqual(['docs/a.md', 'specs/b.md']);
    });

    it('deleteMissing removes rows whose path is absent from the survivor list', async () => {
      const repoId = await makeRepo('delete-missing-repo');
      await repo.upsertDocuments(repoId, [
        { path: 'docs/keep.md', type: 'docs', sizeBytes: 1, contentHash: 'k', tokens: 1 },
        { path: 'docs/gone-1.md', type: 'docs', sizeBytes: 1, contentHash: 'g1', tokens: 1 },
        { path: 'docs/gone-2.md', type: 'docs', sizeBytes: 1, contentHash: 'g2', tokens: 1 },
      ]);

      await repo.deleteMissing(repoId, ['docs/keep.md']);
      const docs = await repo.listDocuments(repoId);
      expect(docs.map((doc) => doc.path)).toEqual(['docs/keep.md']);

      // Empty survivor list clears every row for the repo.
      await repo.deleteMissing(repoId, []);
      expect(await repo.listDocuments(repoId)).toHaveLength(0);
    });
  });

  describe('usedByAgentCounts (AC-11)', () => {
    it('counts a direct attachment and an enabled-skill attachment as 2 distinct agents, 1 once disabled', async () => {
      const repoId = await makeRepo('used-by-repo');
      const path = 'docs/shared.md';
      await repo.upsertDocuments(repoId, [
        { path, type: 'docs', sizeBytes: 1, contentHash: 'h', tokens: 1 },
      ]);

      const agentA = await makeAgent('Agent A');
      const agentB = await makeAgent('Agent B');
      const skillId = await makeSkill('shared-skill', true);
      await pg.handle.db.insert(t.agentSkills).values({ agentId: agentB, skillId, order: 0 });

      // Agent A: direct attachment. Skill (enabled, linked to Agent B): indirect.
      await repo.replaceAttachments(
        { agentId: agentA },
        [{ repoId, path, attachedHash: 'h', attachedSize: 1, attachedRevision: 'rev1' }],
      );
      await repo.replaceAttachments(
        { skillId },
        [{ repoId, path, attachedHash: 'h', attachedSize: 1, attachedRevision: 'rev1' }],
      );

      let counts = await repo.usedByAgentCounts(repoId);
      expect(counts.get(path)).toBe(2);

      // Disable the skill — the two-gate rule drops Agent B from the effective count.
      await pg.handle.db.update(t.skills).set({ enabled: false }).where(eq(t.skills.id, skillId));
      counts = await repo.usedByAgentCounts(repoId);
      expect(counts.get(path)).toBe(1);
    });
  });

  describe('replaceAttachments / listAttachments / getAttachment (AC-14, AC-15)', () => {
    it('assigns a contiguous order and stays idempotent across repeated calls with the same list', async () => {
      const repoId = await makeRepo('replace-repo');
      const path1 = 'docs/one.md';
      const path2 = 'docs/two.md';
      await repo.upsertDocuments(repoId, [
        { path: path1, type: 'docs', sizeBytes: 1, contentHash: 'h1', tokens: 1 },
        { path: path2, type: 'docs', sizeBytes: 1, contentHash: 'h2', tokens: 1 },
      ]);
      const agentId = await makeAgent('Replace Agent');

      const rows = [
        { repoId, path: path1, attachedHash: 'h1', attachedSize: 1, attachedRevision: 'rev' },
        { repoId, path: path2, attachedHash: 'h2', attachedSize: 1, attachedRevision: 'rev' },
      ];

      await repo.replaceAttachments({ agentId }, rows);
      await repo.replaceAttachments({ agentId }, rows);

      const attachments = await repo.listAttachments({ agentId });
      expect(attachments).toHaveLength(2);
      expect(attachments.map((row) => row.path)).toEqual([path1, path2]);
      expect(attachments.map((row) => row.order)).toEqual([0, 1]);

      const one = await repo.getAttachment({ agentId }, repoId, path1);
      expect(one?.attachedHash).toBe('h1');

      // Replacing with a reordered, shorter list still leaves a contiguous
      // order and exactly one row per (owner, repo_id, path).
      await repo.replaceAttachments({ agentId }, [rows[1]!]);
      const after = await repo.listAttachments({ agentId });
      expect(after).toHaveLength(1);
      expect(after[0]!.path).toBe(path2);
      expect(after[0]!.order).toBe(0);
    });
  });

  describe('driftedFor (Fix 3 — drift owners)', () => {
    it('names the right owners for a document attached to both an agent and an enabled linked skill, and is empty when nothing drifted', async () => {
      const repoId = await makeRepo('drift-owners-repo');
      const path = 'docs/shared.md';
      await repo.upsertDocuments(repoId, [
        { path, type: 'docs', sizeBytes: 1, contentHash: 'h', tokens: 1 },
      ]);

      const directAgent = await makeAgent('Direct Agent');
      const linkedAgent = await makeAgent('Linked Agent');
      const skillId = await makeSkill('drift-skill', true);
      await pg.handle.db.insert(t.agentSkills).values({ agentId: linkedAgent, skillId, order: 0 });

      await repo.replaceAttachments(
        { agentId: directAgent },
        [{ repoId, path, attachedHash: 'h', attachedSize: 1, attachedRevision: 'rev1' }],
      );
      await repo.replaceAttachments(
        { skillId },
        [{ repoId, path, attachedHash: 'h', attachedSize: 1, attachedRevision: 'rev1' }],
      );

      // Nothing drifted yet — attached hash still matches the document.
      expect((await repo.driftedFor(repoId)).size).toBe(0);

      // The clone changed — a rescan upserts the new hash.
      await repo.upsertDocuments(repoId, [
        { path, type: 'docs', sizeBytes: 2, contentHash: 'changed', tokens: 2 },
      ]);

      const drifted = await repo.driftedFor(repoId);
      const owners = drifted.get(path) ?? [];
      expect(owners).toHaveLength(2);
      expect(owners).toEqual(
        expect.arrayContaining([
          { owner_kind: 'agent', owner_id: directAgent, owner_name: 'Direct Agent' },
          { owner_kind: 'skill', owner_id: skillId, owner_name: 'drift-skill' },
        ]),
      );

      // Disabling the skill drops it from the gated result — same two-gate
      // rule (enabled AND linked) `usedByAgentCounts` applies.
      await pg.handle.db.update(t.skills).set({ enabled: false }).where(eq(t.skills.id, skillId));
      const afterDisable = await repo.driftedFor(repoId);
      expect((afterDisable.get(path) ?? []).map((o) => o.owner_kind)).toEqual(['agent']);
    });
  });

  describe('driftedPaths / updateAttachedHash (AC-36, AC-37)', () => {
    it('flags a path drifted after its document hash changes, and clears it once confirmed', async () => {
      const repoId = await makeRepo('drift-repo');
      const path = 'docs/drift.md';
      await repo.upsertDocuments(repoId, [
        { path, type: 'docs', sizeBytes: 1, contentHash: 'original', tokens: 1 },
      ]);
      const agentId = await makeAgent('Drift Agent');
      await repo.replaceAttachments(
        { agentId },
        [{ repoId, path, attachedHash: 'original', attachedSize: 1, attachedRevision: 'rev1' }],
      );

      expect(await repo.driftedPaths(repoId)).toEqual([]);

      // The clone changed — a rescan upserts the new hash.
      await repo.upsertDocuments(repoId, [
        { path, type: 'docs', sizeBytes: 2, contentHash: 'changed', tokens: 2 },
      ]);
      expect(await repo.driftedPaths(repoId)).toEqual([path]);

      await repo.updateAttachedHash({ agentId }, repoId, path, {
        attachedHash: 'changed',
        attachedSize: 2,
        attachedRevision: 'rev2',
      });
      expect(await repo.driftedPaths(repoId)).toEqual([]);
      const confirmed = await repo.getAttachment({ agentId }, repoId, path);
      expect(confirmed?.attachedRevision).toBe('rev2');
    });
  });
});
