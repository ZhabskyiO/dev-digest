/**
 * Per-severity FINDINGS tally on the PR list — GET /repos/:id/pulls.
 *
 * The tally spans EVERY review on a PR (like `cost_usd`, unlike `score`, which
 * is latest-review only), so the coverage here is mostly about summing across
 * review rows. Needs Postgres for the findings → reviews join, so it is gated
 * on Docker like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `findings-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 41,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

/** One review on `prId` carrying findings of the given severities. */
async function addReview(
  db: PgFixture['handle']['db'],
  args: { workspaceId: string; prId: string; severities: string[] },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId: args.workspaceId, prId: args.prId, kind: 'review', score: 61 })
    .returning();
  if (args.severities.length > 0) {
    await db.insert(t.findings).values(
      args.severities.map((severity, i) => ({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: i + 1,
        endLine: i + 1,
        severity,
        category: 'security',
        title: `finding ${i}`,
        rationale: 'because',
        confidence: 0.9,
      })),
    );
  }
  return review!;
}

/** The list route syncs from GitHub first; an empty mock keeps only our rows. */
const listApp = (db: PgFixture['handle']['db']) =>
  buildApp({
    config: config(),
    db,
    overrides: { github: new MockGitHubClient({ pulls: [] }) },
  });

d('PR list findings tally (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('sums findings across every review on the PR', async () => {
    const db = pg.handle.db;
    const app = await listApp(db);
    const { repo, pr } = await setupRepoAndPr(db, workspaceId);
    await addReview(db, {
      workspaceId,
      prId: pr.id,
      severities: ['CRITICAL', 'WARNING', 'SUGGESTION'],
    });
    // A re-review adds to the tally rather than replacing it.
    await addReview(db, { workspaceId, prId: pr.id, severities: ['CRITICAL', 'CRITICAL'] });

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(res.statusCode).toBe(200);
    const [row] = res.json() as PrMeta[];
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 3, WARNING: 1, SUGGESTION: 1 });
  });

  it('reports all-zero for a PR with no reviews', async () => {
    const db = pg.handle.db;
    const app = await listApp(db);
    const { repo } = await setupRepoAndPr(db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    const [row] = res.json() as PrMeta[];
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });

  it('drops severities outside the contract enum instead of widening the shape', async () => {
    const db = pg.handle.db;
    const app = await listApp(db);
    const { repo, pr } = await setupRepoAndPr(db, workspaceId);
    // `findings.severity` is a free-form text column, so a stray value is possible.
    await addReview(db, { workspaceId, prId: pr.id, severities: ['CRITICAL', 'NITPICK'] });

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    const [row] = res.json() as PrMeta[];
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it('keeps each PR’s tally to its own reviews', async () => {
    const db = pg.handle.db;
    const app = await listApp(db);
    const { repo, pr } = await setupRepoAndPr(db, workspaceId);
    const [other] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: 42,
        title: 'Bump node',
        author: 'deepak.r',
        branch: 'chore/node',
        base: 'main',
        headSha: 'cafebabe',
        additions: 1,
        deletions: 1,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    await addReview(db, { workspaceId, prId: pr.id, severities: ['CRITICAL'] });
    await addReview(db, { workspaceId, prId: other!.id, severities: ['WARNING', 'WARNING'] });

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    const rows = res.json() as PrMeta[];
    const byNumber = new Map(rows.map((r) => [r.number, r.findings_by_severity]));
    expect(byNumber.get(41)).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(byNumber.get(42)).toEqual({ CRITICAL: 0, WARNING: 2, SUGGESTION: 0 });
  });
});
