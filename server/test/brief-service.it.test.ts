/**
 * `BriefService.generate` — the brief's generation contract:
 *
 *  - ONE model call per generation (the batched `FileSummaries` call). The
 *    intent is READ from `pr_intent`, never re-derived — there is no `Intent`
 *    schema call on this path at all, and a persisted intent row is what
 *    reaches the prompt.
 *  - The model sees ARTIFACTS, never a patch body: the prompt is asserted to
 *    carry the intent, blast summary and grouped diff stats and to contain
 *    none of the `pr_files.patch` text.
 *  - `force`: without it an existing brief for the current head is returned
 *    with zero model calls; with it the brief is regenerated.
 *  - The CRITICAL cross-workspace leak regression (a `pr-self-review`
 *    security pass): the workspace-scoped `getPull` lives at the TOP of
 *    `generate()`, ahead of the static `inFlight` map lookup (marked with a
 *    `SECURITY:` comment reading "MUST NOT move below it"). The ordering
 *    has no other enforcement than that comment — case 1 below is what makes
 *    a refactor that hoists the map lookup back above the check fail loudly.
 *  - AC-5 dedupe and the duplicate-path de-dupe in the summaries reply.
 *
 * Real Postgres via `test/helpers/pg.ts` (hence `.it.test.ts`, per
 * `server/CLAUDE.md`'s unit/integration split) + `BriefService` constructed
 * from a real `Container` (`app.container`, `buildApp`'s established
 * pattern, e.g. `blast.it.test.ts`) with a fake `LLMProvider` injected via
 * `ContainerOverrides.llm` and a stubbed `BlastService` via
 * `ContainerOverrides.blast`. No Drizzle `db` mocking anywhere — every
 * read/write in these tests goes through the real repositories against the
 * real container.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { BriefService } from '../src/modules/reviews/brief/index.js';
import { NotFoundError, ExternalServiceError } from '../src/platform/errors.js';
import * as t from '../src/db/schema.js';
import type { BlastService } from '../src/modules/blast/service.js';
import type { Db } from '../src/db/client.js';
import type { BlastRadiusResult, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-service] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The patch body seeded on every `pr_files` row — asserted ABSENT from the prompt. */
const PATCH_MARKER = 'SENTINEL_PATCH_LINE_NEVER_IN_PROMPT';
const PATCH = `@@ -1,3 +1,12 @@\n+ const ${PATCH_MARKER} = 1;`;

/** The persisted intent's statement — asserted PRESENT in the prompt. */
const INTENT_STATEMENT = 'Adds retry handling for failed card charges.';

/** A schema-valid single-file-summaries reply for one path. */
function fileSummariesFixture(path: string): unknown {
  return { summaries: [{ path, summary: 'Adds a bounded retry loop around the charge call.' }] };
}

const BLAST_SUMMARY = '1 changed symbol · 3 callers · 1 endpoint';

/**
 * A `BlastService` stub — `getBrief` makes ONE `container.blast.blastForPull`
 * call per read and `collectArtifacts` one per generation; these tests are
 * about the generation contract, not the blast map itself, so this returns
 * a fixed, minimal `BlastRadiusResult` keyed to whatever `prId` is asked
 * for. Mirrors `ContainerOverrides.blast`'s own doc comment in
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
    summary: BLAST_SUMMARY,
  });
  return { blastForPull } as unknown as BlastService;
}

/**
 * Delays every `completeStructured` call by `delayMs` before delegating to
 * `MockLLMProvider`'s own fixture handling — the instrument that "genuinely"
 * holds a derivation in flight, same technique (and same real-timer, not
 * fake-timer, style — this is testcontainers-backed, not hermetic)
 * `test/reviews.it.test.ts`'s own `SlowLLM` uses for `IntentService`'s
 * identical `inFlight` dedupe shape.
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

/** A provider whose every structured call fails — the AC-6 instrument. */
class FailingLLM extends MockLLMProvider {
  override async completeStructured<T>(): Promise<StructuredResult<T>> {
    throw new Error('provider down');
  }
}

/** Every structured call the mock served. */
function structuredCalls(llm: MockLLMProvider) {
  return llm.calls.filter((c) => c.method === 'completeStructured');
}

/** Structured calls the mock served, filtered to one `schemaName`. */
function callsFor(llm: MockLLMProvider, schemaName: string) {
  return structuredCalls(llm).filter(
    (c) => (c.req as { schemaName?: string }).schemaName === schemaName,
  );
}

/** The user-message text of one recorded structured call. */
function promptOf(call: { req: unknown }): string {
  const req = call.req as { messages: { content: string }[] };
  return req.messages.map((m) => m.content).join('\n');
}

let prNumberSeq = 9000;

/** Insert one PR (with one core-file `pr_files` row) under `repoId`/`workspaceId`. */
async function insertPr(
  db: Db,
  workspaceId: string,
  repoId: string,
  path = 'src/payments/charge.ts',
): Promise<{ prId: string; headSha: string }> {
  const number = prNumberSeq++;
  const headSha = `sha-brief-it-${number}`;
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
      headSha,
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
    patch: PATCH,
  });
  return { prId: pr!.id, headSha };
}

/** Seed the persisted intent the brief is expected to READ (never re-derive). */
async function insertIntent(db: Db, prId: string, headSha: string): Promise<void> {
  await db.insert(t.prIntent).values({
    prId,
    intent: INTENT_STATEMENT,
    inScope: ['payment retry'],
    outOfScope: ['refunds'],
    riskAreas: [],
    headSha,
    confidence: 'high',
    confidenceScore: 0.9,
    sources: ['title', 'branch', 'commits', 'paths'],
    provider: 'openai',
    model: 'gpt-test',
    tokensIn: 777,
    tokensOut: 20,
    costUsd: 0.001,
  });
}

d('BriefService.generate', () => {
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
    'issues EXACTLY ONE model call, reads the intent from pr_intent (no Intent re-derive), ' +
      'and feeds the model artifacts — intent, blast summary, diff stats — never the patch',
    async () => {
      const path = 'src/payments/charge-one-call.ts';
      const { prId, headSha } = await insertPr(pg.handle.db, workspaceA, repoId, path);
      await insertIntent(pg.handle.db, prId, headSha);
      const llm = new MockLLMProvider('openai', {
        structuredBySchema: { FileSummaries: fileSummariesFixture(path) },
      });
      const { app, service } = await makeService(llm);

      try {
        const detail = await service.generate(workspaceA, prId, { force: true });

        expect(structuredCalls(llm)).toHaveLength(1);
        expect(callsFor(llm, 'Intent')).toHaveLength(0);
        expect(callsFor(llm, 'FileSummaries')).toHaveLength(1);

        const prompt = promptOf(callsFor(llm, 'FileSummaries')[0]!);
        expect(prompt).toContain(`intent: ${INTENT_STATEMENT}`);
        expect(prompt).toContain('in scope: payment retry');
        expect(prompt).toContain(`blast radius (ready): ${BLAST_SUMMARY}`);
        expect(prompt).toContain('diff stats: 1 files changed, +12/-3: 1 core (+12/-3)');
        expect(prompt).toContain(`path: ${path}`);
        expect(prompt).not.toContain(PATCH_MARKER);
        expect(prompt).not.toContain('@@ -1,3');

        // The brief's provenance is the summaries call's alone (the mock
        // reports 100/50) — the intent row's 777/20 tokens are NOT folded in,
        // because they were not spent here.
        expect(detail.intent?.intent).toBe(INTENT_STATEMENT);
        expect(detail.summarized_files).toBe(1);
        expect(detail.tokens_in).toBe(100);
        expect(detail.tokens_out).toBe(50);

        // The persisted intent row is byte-identical — nothing re-derived it.
        const [intentRow] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
        expect(intentRow?.intent).toBe(INTENT_STATEMENT);
        expect(intentRow?.tokensIn).toBe(777);
      } finally {
        await app.close();
      }
    },
  );

  it('still generates (one call, "(not derived yet)" in the prompt) when no intent row exists', async () => {
    const path = 'src/payments/charge-no-intent.ts';
    const { prId } = await insertPr(pg.handle.db, workspaceA, repoId, path);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummaries: fileSummariesFixture(path) },
    });
    const { app, service } = await makeService(llm);
    try {
      const detail = await service.generate(workspaceA, prId);
      expect(structuredCalls(llm)).toHaveLength(1);
      expect(promptOf(structuredCalls(llm)[0]!)).toContain('intent: (not derived yet)');
      expect(detail.intent).toBeNull();
      expect(detail.summarized_files).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('force=false returns the existing brief for the current head with ZERO model calls; force=true regenerates', async () => {
    const path = 'src/payments/charge-force.ts';
    const { prId } = await insertPr(pg.handle.db, workspaceA, repoId, path);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummaries: fileSummariesFixture(path) },
    });
    const { app, service } = await makeService(llm);
    try {
      const first = await service.generate(workspaceA, prId);
      expect(structuredCalls(llm)).toHaveLength(1);

      const again = await service.generate(workspaceA, prId);
      expect(structuredCalls(llm)).toHaveLength(1);
      expect(again.generated_at).toBe(first.generated_at);

      const forced = await service.generate(workspaceA, prId, { force: true });
      expect(structuredCalls(llm)).toHaveLength(2);
      expect(forced.pr_id).toBe(prId);
    } finally {
      await app.close();
    }
  });

  it('AC-6: a failed model call answers ExternalServiceError and leaves the prior brief untouched', async () => {
    const path = 'src/payments/charge-fail.ts';
    const { prId } = await insertPr(pg.handle.db, workspaceA, repoId, path);
    const okLlm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummaries: fileSummariesFixture(path) },
    });
    const { app: okApp, service: okService } = await makeService(okLlm);
    const { app: failApp, service: failService } = await makeService(new FailingLLM('openai', {}));
    try {
      const before = await okService.generate(workspaceA, prId, { force: true });
      await expect(failService.generate(workspaceA, prId, { force: true })).rejects.toBeInstanceOf(
        ExternalServiceError,
      );
      const after = await okService.getBrief(workspaceA, prId);
      expect(after?.generated_at).toBe(before.generated_at);
      expect(after?.summarized_files).toBe(1);
    } finally {
      await okApp.close();
      await failApp.close();
    }
  });

  it(
    'SECURITY (regression): a concurrent generate() in workspace B for a PR genuinely in flight under workspace A ' +
      'rejects with NotFoundError and never resolves to A\'s PrBriefDetail — while A\'s own call still completes intact',
    async () => {
      const path = 'src/payments/charge-a.ts';
      const { prId, headSha } = await insertPr(pg.handle.db, workspaceA, repoId, path);
      await insertIntent(pg.handle.db, prId, headSha);
      // 150ms is a large multiple of a single local Postgres round trip
      // (workspace B's whole path is ONE `getPull` query) — the same margin
      // shape `reviews.it.test.ts`'s `SlowLLM` (60ms) relies on for an
      // identical `inFlight`-map race.
      const llm = new SlowLLM(150, 'openai', {
        structuredBySchema: { FileSummaries: fileSummariesFixture(path) },
      });
      const { app, service } = await makeService(llm);

      try {
        // Kick off A's generation; DO NOT await yet — it must still be
        // in-flight (blocked inside the delayed model call) when B fires.
        const promiseA = service.generate(workspaceA, prId, { force: true });
        // Give A's chain (getPull -> collectArtifacts' DB reads) room to
        // reach the delayed model call and set `BriefService.inFlight`'s
        // entry for this `prId` — well under the 150ms the model call itself
        // is held open for.
        await new Promise((r) => setTimeout(r, 30));

        const promiseB = service.generate(workspaceB, prId, { force: true });
        await expect(promiseB).rejects.toBeInstanceOf(NotFoundError);

        // A's own call is unaffected by B's rejected attempt and completes
        // with its own workspace's data.
        const detailA = await promiseA;
        expect(detailA.pr_id).toBe(prId);
        expect(detailA.intent?.intent).toBe(INTENT_STATEMENT);
        expect(detailA.summarized_files).toBe(1);
      } finally {
        await app.close();
      }
    },
  );

  it('AC-5: two concurrent generate() calls in the SAME workspace share ONE derivation — one model call total', async () => {
    const path = 'src/payments/charge-b.ts';
    const { prId } = await insertPr(pg.handle.db, workspaceA, repoId, path);
    const llm = new SlowLLM(60, 'openai', {
      structuredBySchema: { FileSummaries: fileSummariesFixture(path) },
    });
    const { app, service } = await makeService(llm);

    try {
      const [detail1, detail2] = await Promise.all([
        service.generate(workspaceA, prId, { force: true }),
        service.generate(workspaceA, prId, { force: true }),
      ]);

      // Same object reference — one shared derivation resolved once, not two
      // coincidentally-equal calls.
      expect(detail1).toBe(detail2);
      expect(structuredCalls(llm)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it(
    'a duplicate `path` in the file-summaries reply yields exactly ONE pr_file_summary row for it ' +
      '(not a silent zero-rows write via the swallowed Postgres 21000)',
    async () => {
      const path = 'src/payments/charge-c.ts';
      const { prId } = await insertPr(pg.handle.db, workspaceA, repoId, path);
      const llm = new MockLLMProvider('openai', {
        structuredBySchema: {
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
        // records that the model returned the same path twice. The de-dupe
        // is still correct — without it the whole upsert aborts on Postgres
        // 21000 and every summary is lost.
        expect(rows[0]?.summary).toBe('First summary for this path.');
      } finally {
        await app.close();
      }
    },
  );
});
