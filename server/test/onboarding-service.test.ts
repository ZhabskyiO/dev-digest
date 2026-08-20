/**
 * T10 (onboarding-tour plan) — `OnboardingService`.
 *
 * Hermetic: no DB, no Docker, no filesystem clone. `container.reviewRepo`,
 * `container.repoIntel`, `container.jobs`, `container.llm`, and
 * `container.db` (only `resolveFeatureModel`'s `settings` query shape) are
 * all hand-built fakes cast `as unknown as Container` — the same pattern
 * already used at `test/project-context-path-guard.test.ts` and the
 * `LocalReviewService` precedent recorded in `server/insights/INSIGHTS.md`
 * (2026-08-18): fake just the one query shape a call site issues, no real
 * drizzle instance needed.
 *
 * `OnboardingService`'s in-flight registry and last-failure-reason map are
 * MODULE-level (by design — see `service.ts`'s header), so every test below
 * uses its own unique `repoId` to avoid cross-test leakage within this file.
 */
import { describe, it, expect } from 'vitest';
import type {
  OnboardingDraft,
  OnboardingDraftSection,
  OnboardingSectionKind,
  Onboarding,
} from '@devdigest/shared';
import type { Container } from '../src/platform/container.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import { OnboardingRepository } from '../src/modules/onboarding/repository.js';
import { ONBOARDING_JOB_KIND, SECTION_KINDS } from '../src/modules/onboarding/constants.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** In-memory stand-in for `OnboardingRepository` — matches its public surface. */
class FakeOnboardingRepository {
  store = new Map<string, { json: unknown; generatedAt: Date }>();
  async get(repoId: string) {
    return this.store.get(repoId) ?? null;
  }
  async upsert(repoId: string, payload: unknown) {
    this.store.set(repoId, { json: payload, generatedAt: new Date() });
  }
  async remove(repoId: string) {
    this.store.delete(repoId);
  }
}

/** In-memory stand-in for `JobRunner` — enough of `enqueue`/`register` to drive the job handler directly. */
class FakeJobRunner {
  enqueueCalls: { workspaceId: string; kind: string; payload: unknown }[] = [];
  private handlers = new Map<string, (payload: unknown, ctx: { jobId: string }) => Promise<void>>();
  private counter = 0;

  register(kind: string, handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(workspaceId: string, kind: string, payload: unknown) {
    this.enqueueCalls.push({ workspaceId, kind, payload });
    const id = `job-${++this.counter}`;
    return { id, done: Promise.resolve() };
  }

  /** Runs the registered handler directly — simulates the queue draining. */
  async run(kind: string, payload: unknown, jobId: string): Promise<void> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`no handler registered for ${kind}`);
    await handler(payload, { jobId });
  }
}

/** Spy `LLMProvider` — records every `completeStructured` call and returns a fixed draft (or throws). */
function makeLlmSpy(opts: { draft?: OnboardingDraft; throws?: Error }) {
  const calls: { model: string; maxRetries?: number; schemaName: string }[] = [];
  return {
    calls,
    provider: {
      id: 'openrouter' as const,
      listModels: async () => [],
      complete: async () => {
        throw new Error('not used');
      },
      completeStructured: async (req: { model: string; maxRetries?: number; schemaName: string }) => {
        calls.push({ model: req.model, maxRetries: req.maxRetries, schemaName: req.schemaName });
        if (opts.throws) throw opts.throws;
        return {
          data: opts.draft,
          model: req.model,
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.001,
          raw: '',
          attempts: 1,
        };
      },
      embed: async () => [],
    },
  };
}

function makeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 5,
    lastIndexedSha: 'sha-1',
    indexerVersion: 1,
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** A full, minimal draft section for `kind` — architecture carries non-empty body, everything else is blank. */
function blankDraftSection(kind: OnboardingSectionKind): OnboardingDraftSection {
  return {
    kind,
    title: `Title: ${kind}`,
    body: kind === 'architecture' ? 'Architecture prose.' : '',
    diagram: null,
    links: [],
    critical_paths: [],
    routes: [],
    commands: [],
    reading_path: [],
    first_tasks: [],
  };
}

function makeBlankDraft(): OnboardingDraft {
  return { sections: SECTION_KINDS.map((kind) => blankDraftSection(kind)) };
}

interface FakeContainerOpts {
  indexState: IndexState;
  repoRow?: { id: string; workspaceId: string; fullName: string; clonePath: string | null } | null;
  llm: ReturnType<typeof makeLlmSpy>;
  jobs: FakeJobRunner;
  settingsRows?: { key: string; value: unknown }[];
}

function makeContainer(opts: FakeContainerOpts): Container {
  const repoIntel = {
    getIndexState: async () => opts.indexState,
    getTopFilesByRank: async () => [],
    getCriticalPaths: async () => [],
    getEndpointFacts: async () => [],
    getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
    getFileRank: async () => [],
  };

  const container = {
    db: {
      select: () => ({
        from: () => ({
          where: async () => opts.settingsRows ?? [],
        }),
      }),
    },
    config: {
      onboardingMaxEndpointFacts: 200,
      onboardingPromptTokenBudget: 28000,
      onboardingMaxExcerptFiles: 10,
      onboardingExcerptCharCap: 4000,
      onboardingLanguage: 'English',
      onboardingGenerationTimeoutMs: 90000,
      onboardingMinSectionItems: 1,
      onboardingMaxCriticalPaths: 8,
      onboardingMaxCommands: 12,
      onboardingMaxReadingPath: 7,
      onboardingMaxFirstTasks: 5,
      onboardingMaxFrontendRoutes: 12,
      onboardingMaxApiEndpoints: 24,
    },
    repoIntel,
    reviewRepo: {
      getRepo: async (_id: string) =>
        opts.repoRow === undefined
          ? { id: 'repo-1', workspaceId: 'ws-1', fullName: 'acme/widgets', clonePath: null }
          : opts.repoRow,
    },
    jobs: opts.jobs,
    llm: async (_id: string) => opts.llm.provider,
  };
  return container as unknown as Container;
}

function makeService(container: Container): { service: OnboardingService; repo: FakeOnboardingRepository } {
  const service = new OnboardingService(container);
  const repo = new FakeOnboardingRepository();
  (service as unknown as { repo: OnboardingRepository }).repo = repo as unknown as OnboardingRepository;
  return { service, repo };
}

function storedTour(overrides: Partial<Onboarding> = {}): Onboarding {
  return {
    sections: SECTION_KINDS.map((kind) => ({
      kind,
      title: `T ${kind}`,
      ...(kind === 'architecture'
        ? { body: 'Body.', diagram: null, links: [] }
        : { items: [], diagram: null, links: [], empty_reason: 'insufficient_grounding' }),
    })) as Onboarding['sections'],
    generated_at: '2026-08-01T00:00:00.000Z',
    indexed_revision: 'sha-1',
    indexed_file_count: 42,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    degraded_reason: null,
    ...overrides,
  };
}

async function runJob(service: OnboardingService, jobs: FakeJobRunner, repoId: string): Promise<void> {
  service.registerJobHandlers();
  await jobs.run(ONBOARDING_JOB_KIND, { repoId }, 'job-x');
}

// ---------------------------------------------------------------------------
// (a) getTour over a stored row — zero provider calls, however many times.
// ---------------------------------------------------------------------------

describe('OnboardingService.getTour', () => {
  it('(a) serves a stored, valid tour with zero provider calls, repeatedly', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({ lastIndexedSha: 'sha-1' });
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-a';
    await repo.upsert(repoId, storedTour());

    for (let i = 0; i < 3; i++) {
      const res = await service.getTour('ws-1', repoId);
      expect(res.state).toBe('ready');
      expect(res.tour?.sections.length).toBe(6);
      expect(res.stale).toBe(false);
    }
    expect(llm.calls.length).toBe(0);
  });

  it('(b) no usable index + no stored tour -> not_indexed, zero provider calls', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({ status: 'failed', filesIndexed: 0 });
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    const res = await service.getTour('ws-1', 'repo-b');
    expect(res.state).toBe('not_indexed');
    expect(res.tour).toBeNull();
    expect(llm.calls.length).toBe(0);
  });

  it('(b2) zero filesIndexed alone is unusable, even with a non-failed status', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({ status: 'degraded', filesIndexed: 0, degradedReason: 'no_data' });
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    const res = await service.getTour('ws-1', 'repo-b2');
    expect(res.state).toBe('not_indexed');
    expect(llm.calls.length).toBe(0);
  });

  it('a usable index with no stored tour -> empty (Rec-3)', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    const res = await service.getTour('ws-1', 'repo-empty');
    expect(res.state).toBe('empty');
    expect(res.tour).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) degraded index still generates, recording the reason.
// ---------------------------------------------------------------------------

describe('OnboardingService generation — degraded index (AC-7)', () => {
  it('(c) partial/degraded index generates anyway and stores the degraded reason', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({
      status: 'partial',
      filesIndexed: 5,
      degraded: true,
      degradedReason: 'index_partial',
    });
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-c';
    await runJob(service, jobs, repoId);

    const row = await repo.get(repoId);
    expect(row).not.toBeNull();
    const payload = row!.json as Onboarding;
    expect(payload.degraded_reason).toBe('index_partial');
    expect(payload.sections.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// (d) one generation -> exactly one completeStructured call, maxRetries: 1.
// ---------------------------------------------------------------------------

describe('OnboardingService generation — cost fence (AC-5)', () => {
  it('(d) issues exactly one completeStructured call with maxRetries: 1', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    await runJob(service, jobs, 'repo-d');

    expect(llm.calls.length).toBe(1);
    expect(llm.calls[0]!.maxRetries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (e) in-flight dedupe.
// ---------------------------------------------------------------------------

describe('OnboardingService.requestGeneration (AC-27)', () => {
  it('(e) two back-to-back calls return the same job id and enqueue exactly one job', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    const repoId = 'repo-e';
    const first = await service.requestGeneration('ws-1', repoId);
    const second = await service.requestGeneration('ws-1', repoId);

    expect(first.state).toBe('generating');
    expect(second.state).toBe('generating');
    expect(second.job.id).toBe(first.job.id);
    expect(jobs.enqueueCalls.length).toBe(1);
  });

  it('getTour reports generating with the in-flight job id while a job is outstanding', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    const repoId = 'repo-e2';
    const gen = await service.requestGeneration('ws-1', repoId);
    const tourRes = await service.getTour('ws-1', repoId);
    expect(tourRes.state).toBe('generating');
    expect(tourRes.job_id).toBe(gen.job.id);
  });
});

// ---------------------------------------------------------------------------
// (f) provider failure leaves storage untouched and resolves, not rejects.
// ---------------------------------------------------------------------------

describe('OnboardingService generation — failure handling (AC-28)', () => {
  it('(f) a throwing provider leaves a previously stored tour byte-identical, surfaces a reason, and the handler resolves', async () => {
    const llm = makeLlmSpy({ throws: new Error('provider exploded') });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-f';
    const previous = storedTour({ generated_at: '2026-01-01T00:00:00.000Z' });
    await repo.upsert(repoId, previous);
    const before = JSON.stringify(await repo.get(repoId));

    await expect(runJob(service, jobs, repoId)).resolves.toBeUndefined();

    const after = JSON.stringify(await repo.get(repoId));
    expect(after).toBe(before);

    const res = await service.getTour('ws-1', repoId);
    expect(res.state).toBe('failed');
    expect(res.failure_reason).toBe('provider exploded');
    expect(res.tour).not.toBeNull();
  });

  it('a throwing provider with no prior tour leaves the repo tour-less and surfaces a reason', async () => {
    const llm = makeLlmSpy({ throws: new Error('boom') });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-f2';
    await expect(runJob(service, jobs, repoId)).resolves.toBeUndefined();

    expect(await repo.get(repoId)).toBeNull();
    const res = await service.getTour('ws-1', repoId);
    expect(res.state).toBe('failed');
    expect(res.tour).toBeNull();
    expect(res.failure_reason).toBe('boom');
  });
});

// ---------------------------------------------------------------------------
// (g) feature-model resolution.
// ---------------------------------------------------------------------------

describe('OnboardingService generation — feature model resolution (AC-4)', () => {
  it('(g) an unset feature_models.onboarding yields the FEATURE_MODELS default', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs, settingsRows: [] });
    const { service, repo } = makeService(container);

    const repoId = 'repo-g1';
    await runJob(service, jobs, repoId);

    const payload = (await repo.get(repoId))!.json as Onboarding;
    expect(payload.provider).toBe('openrouter');
    expect(payload.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('(g) a workspace override changes the recorded provider/model', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({
      indexState,
      llm,
      jobs,
      settingsRows: [
        { key: 'feature_models', value: { onboarding: { provider: 'openai', model: 'gpt-4.1' } } },
      ],
    });
    const { service, repo } = makeService(container);

    const repoId = 'repo-g2';
    await runJob(service, jobs, repoId);

    const payload = (await repo.get(repoId))!.json as Onboarding;
    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-4.1');
  });
});

// ---------------------------------------------------------------------------
// (h) a completed re-index only flips `stale`; zero provider calls; six
// sections still returned in full (AC-29, AC-30, AC-31).
// ---------------------------------------------------------------------------

describe('OnboardingService.getTour — staleness after a re-index (AC-29, AC-30, AC-31)', () => {
  it('(h) a re-index that changed the indexed revision flips stale with zero provider calls, tour still has all six sections', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({ lastIndexedSha: 'sha-1' });
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-h';
    await repo.upsert(repoId, storedTour({ indexed_revision: 'sha-1' }));

    const before = await service.getTour('ws-1', repoId);
    expect(before.stale).toBe(false);

    // Simulate a completed re-index that advanced the indexed revision.
    indexState.lastIndexedSha = 'sha-2';
    const after = await service.getTour('ws-1', repoId);
    expect(after.stale).toBe(true);
    expect(after.state).toBe('ready');
    expect(after.tour?.sections.length).toBe(6);
    expect(llm.calls.length).toBe(0);
  });

  it('a re-index that did not change the revision does not mark the tour stale', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({ lastIndexedSha: 'sha-1' });
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-h2';
    await repo.upsert(repoId, storedTour({ indexed_revision: 'sha-1' }));
    const res = await service.getTour('ws-1', repoId);
    expect(res.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (i) provenance.
// ---------------------------------------------------------------------------

describe('OnboardingService generation — provenance (AC-25)', () => {
  it('(i) the stored payload carries all five provenance fields', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState({ lastIndexedSha: 'sha-9', filesIndexed: 77 });
    const container = makeContainer({ indexState, llm, jobs });
    const { service, repo } = makeService(container);

    const repoId = 'repo-i';
    await runJob(service, jobs, repoId);

    const payload = (await repo.get(repoId))!.json as Onboarding;
    expect(typeof payload.generated_at).toBe('string');
    expect(payload.indexed_revision).toBe('sha-9');
    expect(payload.indexed_file_count).toBe(77);
    expect(typeof payload.provider).toBe('string');
    expect(typeof payload.model).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// AC-31: nothing generates without an explicit request.
// ---------------------------------------------------------------------------

describe('OnboardingService — no implicit generation (AC-31)', () => {
  it('constructing the service and calling getTour never registers or runs a generation', async () => {
    const llm = makeLlmSpy({ draft: makeBlankDraft() });
    const jobs = new FakeJobRunner();
    const indexState = makeIndexState();
    const container = makeContainer({ indexState, llm, jobs });
    const { service } = makeService(container);

    await service.getTour('ws-1', 'repo-noop');
    expect(llm.calls.length).toBe(0);
    expect(jobs.enqueueCalls.length).toBe(0);
  });
});
