/**
 * T7 (onboarding-tour plan) — `OnboardingRepository`.
 *
 * `onboarding` is keyed by `repo_id` as its primary key (AC-24): a successful
 * regeneration must replace the single stored row, not accumulate history.
 * This proves the `insert … onConflictDoUpdate` upsert actually enforces
 * that at the DB level, plus the plain `get`/`remove` read/delete paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { OnboardingRepository } from '../src/modules/onboarding/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('OnboardingRepository — one tour row per repo (T7)', () => {
  let pg: PgFixture;
  let repoId: string;
  let repo: OnboardingRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'onboarding-test', fullName: 'acme/onboarding-test' })
      .returning();
    repoId = r!.id;
    repo = new OnboardingRepository(pg.handle.db);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('get() returns null when no tour is stored', async () => {
    const row = await repo.get(repoId);
    expect(row).toBeNull();
  });

  it('get() returns the stored { json, generatedAt } after an upsert', async () => {
    const payload = { sections: ['first-payload'] };
    await repo.upsert(repoId, payload);

    const row = await repo.get(repoId);
    expect(row).not.toBeNull();
    expect(row!.json).toEqual(payload);
    expect(row!.generatedAt).toBeInstanceOf(Date);
  });

  it('a second upsert leaves exactly one row, with the second payload and an advanced generated_at (AC-24)', async () => {
    const first = await repo.get(repoId);
    const firstGeneratedAt = first!.generatedAt;

    // Ensure a measurable clock advance between the two upserts.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondPayload = { sections: ['second-payload'] };
    await repo.upsert(repoId, secondPayload);

    const rowsForRepo = await pg.handle.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    expect(rowsForRepo).toHaveLength(1);

    const second = await repo.get(repoId);
    expect(second!.json).toEqual(secondPayload);
    expect(second!.generatedAt.getTime()).toBeGreaterThan(firstGeneratedAt.getTime());
  });

  it('remove() deletes the stored tour, and get() then returns null', async () => {
    await repo.remove(repoId);
    const row = await repo.get(repoId);
    expect(row).toBeNull();
  });
});
