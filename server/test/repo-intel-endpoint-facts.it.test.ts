/**
 * T4 (onboarding-tour plan) — `RepoIntelRepository.listFileFacts`.
 *
 * `file_facts` is written only for rows with at least one endpoint or cron
 * (server insight, `repository.ts:381` at write time), so a row with an
 * empty `endpoints` array is a real, expected shape in the table — this
 * read must exclude it, not merely tolerate it. Ordering by `file_path` is
 * load-bearing for AC-53's determinism, so this also proves ordering with
 * file paths that would sort differently than insertion order.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('RepoIntelRepository.listFileFacts — repository-wide endpoint facts (T4)', () => {
  let pg: PgFixture;
  let repoId: string;
  let repo: RepoIntelRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'facts', fullName: 'acme/facts' })
      .returning();
    repoId = r!.id;
    repo = new RepoIntelRepository(pg.handle.db);

    await pg.handle.db.insert(t.fileFacts).values([
      // Deliberately inserted out of file_path order to prove the ORDER BY.
      {
        repoId,
        filePath: 'src/routes/z-late.ts',
        endpoints: ['GET /z'],
        crons: [],
      },
      {
        repoId,
        filePath: 'src/routes/a-early.ts',
        endpoints: ['GET /a', 'POST /a'],
        crons: [],
      },
      // No endpoints, only a cron — must be excluded from the endpoint read.
      {
        repoId,
        filePath: 'src/jobs/cron-only.ts',
        endpoints: [],
        crons: ['0 * * * *'],
      },
    ]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('returns only rows with at least one endpoint, ordered by file_path', async () => {
    const rows = await repo.listFileFacts(repoId, 500);
    expect(rows.map((r) => r.filePath)).toEqual(['src/routes/a-early.ts', 'src/routes/z-late.ts']);
    expect(rows[0]!.endpoints).toEqual(['GET /a', 'POST /a']);
    expect(rows[1]!.endpoints).toEqual(['GET /z']);
  });

  it('applies the limit', async () => {
    const rows = await repo.listFileFacts(repoId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filePath).toBe('src/routes/a-early.ts');
  });
});
