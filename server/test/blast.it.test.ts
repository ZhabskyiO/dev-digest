import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { BlastRadiusResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import { symbolKey } from '../src/modules/repo-intel/types.js';
import type { BlastResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping integration tests.');
}

/**
 * GET /pulls/:id/blast end-to-end over a real Postgres.
 *
 * The repo-intel facade is stubbed (its own walk is covered by
 * blast-facade-walk.test.ts) so these tests are about the route contract: PR
 * resolution, prior-PR overlap out of the DB, and — the one that matters — that
 * an unusable index surfaces as `degraded` rather than as an empty impact map.
 */
d('blast routes', () => {
  let pg: PgFixture;
  let prId: string;
  let repoId: string;

  const readyState: IndexState = {
    repoId: 'set-below',
    lastIndexedSha: 'a1b2c3d4e5f6',
    indexerVersion: 2,
    status: 'full',
    filesIndexed: 120,
    filesSkipped: 0,
    durationMs: 900,
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    repoId = pr!.repoId;
    readyState.repoId = repoId;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(blast: BlastResult, indexState: IndexState = readyState) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const repoIntel = {
      getBlastRadius: async () => blast,
      getIndexState: async () => indexState,
    } as unknown as RepoIntel;
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), repoIntel },
    });
  }

  async function get(blast: BlastResult, indexState?: IndexState) {
    const app = await makeApp(blast, indexState);
    const res = await app.inject({ url: `/pulls/${prId}/blast` });
    await app.close();
    return res;
  }

  it('serves the indexed impact map for the PR', async () => {
    const res = await get({
      changedSymbols: [
        { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
      ],
      callers: [
        {
          file: 'src/api/public/index.ts',
          symbol: 'publicRouter',
          viaSymbol: 'rateLimit',
          viaFile: 'src/middleware/ratelimit.ts',
          line: 23,
          rank: 0.91,
        },
      ],
      impactedEndpoints: ['GET /api/public/items'],
      callerTotals: { [symbolKey('src/middleware/ratelimit.ts', 'rateLimit')]: 1 },
      endpointsBySymbol: {
        [symbolKey('src/middleware/ratelimit.ts', 'rateLimit')]: ['GET /api/public/items'],
      },
      cronsBySymbol: {},
      factsByFile: {
        'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
      },
      degraded: false,
    });

    expect(res.statusCode).toBe(200);
    const body = BlastRadiusResult.parse(res.json());

    expect(body.pull_id).toBe(prId);
    expect(body.status).toBe('ready');
    expect(body.reason).toBeNull();
    expect(body.degraded).toBe(false);
    // the seeded PR's four files
    expect(body.changed_files).toContain('src/middleware/ratelimit.ts');
    expect(body.symbols[0]?.name).toBe('rateLimit');
    expect(body.symbols[0]?.callers[0]).toMatchObject({
      file: 'src/api/public/index.ts',
      line: 23,
    });
    expect(body.symbols[0]?.endpoints[0]).toEqual({
      method: 'GET',
      path: '/api/public/items',
      file: 'src/api/public/index.ts',
    });
    expect(body.summary).toContain('1 changed symbol');
  });

  it('reports the true caller count when the list is capped', async () => {
    const res = await get({
      changedSymbols: [
        { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
      ],
      // the facade already capped these; the total says there were 63
      callers: Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => ({
        file: `src/c${i}.ts`,
        symbol: `c${i}`,
        viaSymbol: 'rateLimit',
        viaFile: 'src/middleware/ratelimit.ts',
        line: i + 1,
        rank: 1 - i / 100,
      })),
      impactedEndpoints: [],
      callerTotals: { [symbolKey('src/middleware/ratelimit.ts', 'rateLimit')]: 63 },
      degraded: false,
    });

    const body = BlastRadiusResult.parse(res.json());
    expect(body.symbols[0]?.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(body.symbols[0]?.caller_count).toBe(63);
  });

  it('an unindexed repo is degraded WITH a reason, not a clean empty map', async () => {
    const res = await get(
      {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        callerTotals: {},
        degraded: true,
        reason: 'no_data',
      },
      { ...readyState, status: 'degraded', degraded: true, degradedReason: 'index_failed' },
    );

    expect(res.statusCode).toBe(200);
    const body = BlastRadiusResult.parse(res.json());
    expect(body.status).toBe('degraded');
    expect(body.degraded).toBe(true);
    expect(body.reason).toBeTruthy();
    // the distinction the whole status field exists for
    expect(body.summary).not.toMatch(/^No indexed symbols/);
  });

  it('a partial index is partial, not degraded — what it found is still true', async () => {
    const res = await get(
      {
        changedSymbols: [
          { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
        ],
        callers: [],
        impactedEndpoints: [],
        callerTotals: { [symbolKey('src/middleware/ratelimit.ts', 'rateLimit')]: 0 },
        degraded: false,
      },
      { ...readyState, status: 'partial', filesSkipped: 12 },
    );

    const body = BlastRadiusResult.parse(res.json());
    expect(body.status).toBe('partial');
    expect(body.degraded).toBe(false);
    expect(body.reason).toContain('12');
  });

  it('is partial when the index predates the PR head, however healthy the index', async () => {
    // The index is built from the default branch, so a PR branch is never in
    // it. Calling this `ready` would present a map that is missing exactly the
    // code under review as if it were complete.
    const res = await get(
      {
        changedSymbols: [
          { file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' },
        ],
        callers: [],
        impactedEndpoints: [],
        callerTotals: { [symbolKey('src/middleware/ratelimit.ts', 'rateLimit')]: 0 },
        degraded: false,
      },
      { ...readyState, lastIndexedSha: '0000000000aa', status: 'full' },
    );

    const body = BlastRadiusResult.parse(res.json());
    expect(body.status).toBe('partial');
    expect(body.reason).toMatch(/symbols this PR ADDS are not indexed/);
    // both revisions are named so the reviewer can tell how far behind it is
    expect(body.reason).toContain('0000000');
    expect(body.reason).toContain('a1b2c3d');
  });

  it('404s for a pull request that is not in this workspace', async () => {
    const app = await makeApp({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      callerTotals: {},
      degraded: false,
    });
    const res = await app.inject({ url: '/pulls/00000000-0000-0000-0000-000000000000/blast' });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('422s on a non-uuid id before the handler runs', async () => {
    const app = await makeApp({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      callerTotals: {},
      degraded: false,
    });
    const res = await app.inject({ url: '/pulls/not-a-uuid/blast' });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('lists prior PRs that touched the same files', async () => {
    // A second PR in the same repo overlapping on two of the seeded paths.
    const [other] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: (await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId)))[0]!
          .workspaceId,
        repoId,
        number: 470,
        title: 'Earlier touch of the same files',
        author: 'someone.else',
        branch: 'feat/earlier',
        base: 'main',
        headSha: 'deadbeef',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      { prId: other!.id, path: 'src/config.ts', additions: 1, deletions: 0 },
      { prId: other!.id, path: 'src/api/users.ts', additions: 2, deletions: 1 },
    ]);

    const res = await get({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      callerTotals: {},
      degraded: false,
    });

    const body = BlastRadiusResult.parse(res.json());
    const prior = body.prior_prs.find((p) => p.number === 470);
    expect(prior).toBeDefined();
    expect(prior?.overlapping_files).toBe(2);
    // never itself
    expect(body.prior_prs.some((p) => p.id === prId)).toBe(false);
  });
});
