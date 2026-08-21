/**
 * `BriefService.generate` — regression coverage for the CRITICAL
 * cross-workspace data leak found by a `pr-self-review` security pass, plus
 * the two adjacent behaviours the fix sits next to (AC-5 dedupe, duplicate
 * per-file summary de-dupe).
 *
 * THE BUG (fixed, no prior test): `generate(workspaceId, prId)` used to
 * consult the static `BriefService.inFlight` map (keyed by `pr_id` ALONE, no
 * workspace scoping) and return the joined promise before any ownership
 * check ever ran — the only check lived inside `doGenerate`. So while
 * workspace A's generation for PR X was in flight, a caller authenticated in
 * workspace B calling `generate(workspaceB, prId)` joined A's promise and
 * received A's full `PrBriefDetail` (intent, blast paths/callers, finding
 * titles, cost).
 *
 * THE FIX: the workspace-scoped `getPull` + `getRepo` moved to the TOP of
 * `generate()`, ahead of the `inFlight.get` lookup (`brief/service.ts`,
 * marked with a `SECURITY:` comment reading "MUST NOT move below it"). The
 * ordering guarantee has no other enforcement than that comment — a refactor
 * that hoists the map lookup back above the ownership check reopens the
 * exact hole with an otherwise-green suite. Case 1 below is what makes that
 * refactor fail loudly instead.
 *
 * Real Postgres via `test/helpers/pg.ts` (hence `.it.test.ts`, per
 * `server/CLAUDE.md`'s unit/integration split) + `BriefService` constructed
 * from a real `Container` (`app.container`, `buildApp`'s established
 * pattern, e.g. `blast.it.test.ts`) with a fake `LLMProvider` injected via
 * `ContainerOverrides.llm` and a stubbed `BlastService` via
 * `ContainerOverrides.blast` (`getBrief`'s one `container.blast` call per
 * read — see `brief/service.ts`'s own header comment). No Drizzle `db`
 * mocking anywhere — every read/write in these tests goes through the real
 * repositories against the real container.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { BriefService } from '../src/modules/reviews/brief/index.js';
import { NotFoundError } from '../src/platform/errors.js';
import * as t from '../src/db/schema.js';
import type { BlastService } from '../src/modules/blast/service.js';
import type { Db } from '../src/db/client.js';
import type { Intent, BlastRadiusResult, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-service] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** What the fake intent model returns — schema-valid, content is irrelevant. */
const INTENT_FIXTURE: Intent = {
  intent: 'Adds retry handling for failed card charges.',
  in_scope: ['payment retry'],
  out_of_scope: ['refunds'],
  risk_areas: [],
};

/** A schema-valid single-file-summaries reply for one path. */
function fileSummariesFixture(path: string): unknown {
  return { summaries: [{ path, summary: 'Adds a bounded retry loop around the charge call.' }] };
}

/**
 * A `BlastService` stub — `getBrief` (called at the end of `doGenerate`) makes
 * exactly ONE `container.blast.blastForPull` call; these tests are about the
 * `generate()` dedupe/ownership ordering, not the blast map itself, so this
 * returns a fixed, minimal `BlastRadiusResult` keyed to whatever `prId` is
 * asked for. Mirrors `ContainerOverrides.blast`'s own doc comment in
 * `platform/container.ts`.
 */
function stubBlast(): BlastService {
  const blastForPull = async (_workspaceId: string, prId: string): Promise<BlastRadiusResult> => ({
    pull_id: prId,
    status: 'ready',
    reason: null,
    degraded: false,
    indexed_sha: null,
    changed_files: [],
    symbols: [],
    endpoints: [],
    crons: [],
    totals: { symbols: 0, added: 0, callers: 0, endpoints: 0, crons: 0 },
    prior_prs: [],
    summary: 'no indexed changes',
  });
  return { blastForPull } as unknown as BlastService;
}

/**
 * Delays every `completeStructured` call by `delayMs` before delegating to
 * `MockLLMProvider`'s own fixture handling — the instrument that "genuinely"
 * holds a derivation in flight, same technique (and same real-timer, not
 * fake-timer, style — this is testcontainers-backed, not hermetic)
 * `test/reviews.it.test.ts`'s own `SlowLLM` uses for `IntentService`'s
 * identical `inFlight` dedupe shape ("concurrent calls for one PR share a
 * single derivation").
 */
class SlowLLM extends MockLLMProvider {
  constructor(
    private delayMs: number,
    ...args: ConstructorParameters<typeof MockLLMProvider>
  ) {
    super(...args);
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return super.completeStructured(req);
  }
}

/** Structured calls the mock served, filtered to one `schemaName`. */
function callsFor(llm: MockLLMProvider, schemaName: string) {
  return llm.calls.filter(
    (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === schemaName,
  );
}

let prNumberSeq = 9000;

/** Insert one PR (with one core-file `pr_files` row) under `repoId`/`workspaceId`. */
async function insertPr(
  db: Db,
  workspaceId: string,
  repoId: string,
  path = 'src/payments/charge.ts',
): Promise<string> {
  const number = prNumberSeq++;
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: `Brief-it test PR #${number}`,
      author: 'octocat',
      branch: `feature/brief-it-${number}`,
      base: 'main',
      headSha: `sha-brief-it-${number}`,
      additions: 12,
      deletions: 3,
      filesCount: 1,
      body: 'No linked ticket in this body.',
    })
    .returning({ id: t.pullRequests.id });
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path,
    additions: 12,
    deletions: 3,
    patch: '@@ -1,3 +1,12 @@\n+ retry logic added here',
  });
  return pr!.id;
}

d('BriefService.generate — inFlight dedupe map vs. workspace ownership', () => {
  let pg: PgFixture;
  let workspaceA: string;
  let workspaceB: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const [wsA] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'brief-it-ws-a' })
      .returning({ id: t.workspaces.id });
    const [wsB] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'brief-it-ws-b' })
      .returning({ id: t.workspaces.id });
    workspaceA = wsA!.id;
    workspaceB = wsB!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: workspaceA, owner: 'acme', name: 'brief-it-repo', fullName: 'acme/brief-it-repo' })
      .returning({ id: t.repos.id });
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /** One app + one `BriefService`, wired to the real (shared) Postgres pool
   *  with `llm` and `blast` injected — no Drizzle `db` mock anywhere. */
  async function makeService(llm: MockLLMProvider) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm }, blast: stubBlast() },
    });
    return { app, service: new BriefService(app.container) };
  }

  it(
    'SECURITY (regression): a concurrent generate() in workspace B for a PR genuinely in flight under workspace A ' +
      'rejects with NotFoundError and never resolves to A\'s PrBriefDetail — while A\'s own call still completes intact',
    async () => {
      const prId = await insertPr(pg.handle.db, workspaceA, repoId, 'src/payments/charge-a.ts');
      // 150ms is a large multiple of a single local Postgres round trip
      // (workspace B's whole path is ONE `getPull` query) — the same margin
      // shape `reviews.it.test.ts`'s `SlowLLM` (60ms) relies on for an
      // identical `inFlight`-map race, just wider since this dedupe sits one
      // layer further from the route (BriefService.generate -> IntentService
      // .recalculate -> the model call).
      const llm = new SlowLLM(150, 'openai', {
        structuredBySchema: {
          Intent: INTENT_FIXTURE,
          FileSummaries: fileSummariesFixture('src/payments/charge-a.ts'),
        },
      });
      const { app, service } = await makeService(llm);

      try {
        // Kick off A's generation; DO NOT await yet — it must still be
        // in-flight (blocked inside the delayed model call) when B fires.
        const promiseA = service.generate(workspaceA, prId);
        // Give A's chain (getPull -> getRepo -> IntentService.recalculate's
        // own DB reads) room to reach the delayed model call and set
        // `BriefService.inFlight`'s entry for this `prId` — well under the
        // 150ms the model call itself is held open for.
        await new Promise((r) => setTimeout(r, 30));

        const promiseB = service.generate(workspaceB, prId);
        await expect(promiseB).rejects.toBeInstanceOf(NotFoundError);

        // A's own call is unaffected by B's rejected attempt and completes
        // with its own workspace's data.
        const detailA = await promiseA;
        expect(detailA.pr_id).toBe(prId);
        expect(detailA.intent?.intent).toBe(INTENT_FIXTURE.intent);
        expect(detailA.summarized_files).toBe(1);
      } finally {
        await app.close();
      }
    },
  );

  it('AC-5: two concurrent generate() calls in the SAME workspace share ONE derivation', async () => {
    const prId = await insertPr(pg.handle.db, workspaceA, repoId, 'src/payments/charge-b.ts');
    const llm = new SlowLLM(60, 'openai', {
      structuredBySchema: {
        Intent: INTENT_FIXTURE,
        FileSummaries: fileSummariesFixture('src/payments/charge-b.ts'),
      },
    });
    const { app, service } = await makeService(llm);

    try {
      const [detail1, detail2] = await Promise.all([
        service.generate(workspaceA, prId),
        service.generate(workspaceA, prId),
      ]);

      // Same object reference — one shared derivation resolved once, not two
      // coincidentally-equal calls.
      expect(detail1).toBe(detail2);
      // Exactly one intent call and one batched file-summaries call total —
      // never two of each.
      expect(callsFor(llm, 'Intent')).toHaveLength(1);
      expect(callsFor(llm, 'FileSummaries')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it(
    'a duplicate `path` in the file-summaries reply yields exactly ONE pr_file_summary row for it ' +
      '(not a silent zero-rows write via the swallowed Postgres 21000)',
    async () => {
      const path = 'src/payments/charge-c.ts';
      const prId = await insertPr(pg.handle.db, workspaceA, repoId, path);
      const llm = new MockLLMProvider('openai', {
        structuredBySchema: {
          Intent: INTENT_FIXTURE,
          FileSummaries: {
            summaries: [
              { path, summary: 'First summary for this path.' },
              { path, summary: 'Second summary for the SAME path — must be dropped.' },
            ],
          },
        },
      });
      const { app, service } = await makeService(llm);

      try {
        const detail = await service.generate(workspaceA, prId);
        expect(detail.summarized_files).toBe(1);

        const rows = await pg.handle.db
          .select()
          .from(t.prFileSummary)
          .where(eq(t.prFileSummary.prId, prId));
        expect(rows).toHaveLength(1);
        // First occurrence wins, and it wins SILENTLY: nothing in the runLog
        // records that the model returned the same path twice, so a model
        // repeatedly misbehaving on one file is invisible in the trace. The
        // de-dupe is still correct — without it the whole upsert aborts on
        // Postgres 21000 and every summary is lost — this note just marks the
        // observability gap the de-dupe leaves behind.
        expect(rows[0]?.summary).toBe('First summary for this path.');
      } finally {
        await app.close();
      }
    },
  );
});
