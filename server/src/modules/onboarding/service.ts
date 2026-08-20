/**
 * Onboarding module (T10) — orchestration, and the ONLY file in this module
 * that reaches the model (`container.llm`) or the background job queue
 * (`container.jobs`). Everything deterministic already exists: T7's
 * `OnboardingRepository` (the only file touching `t.onboarding`) and T8's
 * `evidence.ts` (the only fs-touching file) / `helpers.ts` (pure grounding).
 * This file wires them together behind two public entry points plus the job
 * handler that actually runs a generation.
 *
 * Three things this file exists to protect, per the plan's cost fence:
 *  - The READ path (`getTour`) never calls the model — it only ever reads
 *    the stored row (T7) and `container.repoIntel.getIndexState` (an index
 *    read, not a provider call). AC-48.
 *  - Exactly ONE `completeStructured` call per generation attempt, with
 *    `maxRetries: 1` explicitly set (the adapter default is 2, which means
 *    THREE provider calls — see `openai.ts:99`). AC-5.
 *  - The in-flight registry (AC-27) and the job handler's own try/catch
 *    (AC-28) both live HERE — `JobRunner` retries a THROWING handler up to
 *    twice more (`container.ts`'s `new JobRunner(db)` default `retries: 2`),
 *    so a handler that lets an error escape can spend up to 3x the model
 *    calls one failed attempt already made. `runGeneration` therefore never
 *    rethrows: it catches everything, records the failure for `getTour` to
 *    surface, and resolves.
 *
 * The in-flight registry and the last-failure-reason map are MODULE-level
 * (not instance fields): there is exactly one `OnboardingService` per running
 * process (via `container.onboarding`, T12), but module scope is what the
 * plan specifies and it is also what survives a service being constructed
 * more than once in a test without losing track of an outstanding job.
 */
import type { Container } from '../../platform/container.js';
import { renderPrompt } from '../../platform/prompts.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import {
  Onboarding,
  OnboardingDraft,
  type OnboardingTourResponse,
  type OnboardingGenerateResponse,
} from '@devdigest/shared';
import type { IndexState } from '../repo-intel/types.js';
import { OnboardingRepository } from './repository.js';
import { collectEvidence } from './evidence.js';
import { renderFacts, groundTour } from './helpers.js';
import { SECTION_KINDS, ONBOARDING_JOB_KIND } from './constants.js';

/**
 * The `repos` row shape as returned by `container.reviewRepo.getRepo` — the
 * shared, already-wired cross-module entry point for reading a repo by id
 * (onion rule: reach another module's capability via `container.*`, never
 * import that module's repository file directly). Mirrors the identical
 * type alias at `modules/project-context/service.ts`.
 */
type RepoRow = NonNullable<Awaited<ReturnType<Container['reviewRepo']['getRepo']>>>;

interface OnboardingJobPayload {
  repoId: string;
}

/**
 * In-flight generation registry (AC-27): at most one live job per repo. The
 * value is a `Promise<string>` rather than a bare id so a second caller that
 * arrives while `enqueue()` is still awaiting its DB insert joins the SAME
 * pending job instead of racing it (there is a real await between "no entry
 * yet" and "id known"). Cleared unconditionally once the job settles — see
 * `registerJobHandlers`'s `finally`.
 */
const inFlightJobs = new Map<string, Promise<string>>();

/**
 * The reason the LAST generation attempt for a repo failed, read back by
 * `getTour` so a failure is observable (AC-28: "surface a failure reason")
 * without corrupting the stored tour. Cleared the moment a generation for
 * that repo next succeeds; left untouched by an "index unusable" bail (AC-6
 * says record NOTHING in that case, not even a failure).
 */
const lastFailureReason = new Map<string, string>();

/**
 * How many rank-ordered paths to pull as grounding's `rank` list — the sole
 * ordering/membership source for `critical_paths` and a fallback membership
 * check for every section's `links` (helpers.ts's `groundCriticalPaths`,
 * `groundLinks`). T8's gotcha #1: a tiny top-N silently drops legitimate
 * critical files as "ungrounded" — this is deliberately generous rather than
 * tied to any of the OUTPUT caps in `AppConfig` (those bound what is stored,
 * not what is available to ground against).
 */
const RANK_COVERAGE_LIMIT = 5000;

/**
 * The exact "no usable index" test shared by the read path (AC-6: serve
 * `not_indexed` instead of `empty`) and the job handler (AC-6: bail before
 * any model call). `getIndexState` ALWAYS resolves — it synthesises a
 * degraded row rather than throwing — so this branches on its fields, never
 * on a try/catch.
 */
function isIndexUnusable(state: IndexState): boolean {
  return state.status === 'failed' || state.filesIndexed === 0 || state.degradedReason === 'no_data';
}

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  // ---------------------------------------------------------------------
  // Read path (AC-6, AC-25, AC-29, AC-30, AC-41, AC-48) — zero model calls.
  // ---------------------------------------------------------------------

  /**
   * Serves the stored tour when there is one (or reports why there isn't).
   * `workspaceId` is accepted for signature parity with `requestGeneration`
   * and the route surface — tenancy scoping of `repoId` to `workspaceId` is
   * the route layer's job (mirrors `container.reviewRepo.getRepo`'s own
   * doc comment: it is workspace-scoped only where the id is untrusted
   * input, not where it already comes from a resolved workspace route).
   */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTourResponse> {
    void workspaceId;

    const row = await this.repo.get(repoId);
    // A row that fails the six-section shape (the "legacy row" edge case,
    // T7's repository doc) is treated as ABSENT — never partially served.
    const parsed = row ? Onboarding.safeParse(row.json) : undefined;
    const tour = parsed?.success ? parsed.data : null;

    // Index READ, not a provider call — permitted under AC-48.
    const indexState = await this.container.repoIntel.getIndexState(repoId);
    const stale = tour ? indexState.lastIndexedSha !== tour.indexed_revision : false;

    const inflightJobId = inFlightJobs.get(repoId);
    if (inflightJobId) {
      return { tour, state: 'generating', stale, failure_reason: null, job_id: await inflightJobId };
    }

    const failure = lastFailureReason.get(repoId);
    if (failure) {
      // AC-28: the previous tour (if any) stays intact and is still served
      // here — only the failure notice is layered on top of it.
      return { tour, state: 'failed', stale, failure_reason: failure, job_id: null };
    }

    if (tour) {
      return { tour, state: 'ready', stale, failure_reason: null, job_id: null };
    }

    if (isIndexUnusable(indexState)) {
      return { tour: null, state: 'not_indexed', stale: false, failure_reason: null, job_id: null };
    }
    return { tour: null, state: 'empty', stale: false, failure_reason: null, job_id: null };
  }

  // ---------------------------------------------------------------------
  // Generate path (AC-26, AC-27) — enqueues, never generates inline.
  // ---------------------------------------------------------------------

  async requestGeneration(workspaceId: string, repoId: string): Promise<OnboardingGenerateResponse> {
    const existing = inFlightJobs.get(repoId);
    if (existing) {
      return { state: 'generating', job: { id: await existing } };
    }
    const jobIdPromise = this.container.jobs
      .enqueue(workspaceId, ONBOARDING_JOB_KIND, { repoId } satisfies OnboardingJobPayload)
      .then((enqueued) => enqueued.id);
    inFlightJobs.set(repoId, jobIdPromise);
    const jobId = await jobIdPromise;
    return { state: 'generating', job: { id: jobId } };
  }

  // ---------------------------------------------------------------------
  // Job handler (AC-3, AC-4, AC-5, AC-7, AC-28, AC-31) — the only place
  // that spends money. Invoked once from routes.ts at boot (T12), mirroring
  // `RepoIntelService.registerIndexJobHandlers`.
  // ---------------------------------------------------------------------

  registerJobHandlers(): void {
    this.container.jobs.register(ONBOARDING_JOB_KIND, async (payload) => {
      const { repoId } = payload as OnboardingJobPayload;
      try {
        await this.runGeneration(repoId);
      } finally {
        // Cleared unconditionally — success, a recorded failure, and an
        // early "index unusable" bail all end the in-flight window the same
        // way. `runGeneration` never throws (see its own try/catch), so this
        // `finally` is reached on every path and `JobRunner`'s own retry
        // (container.ts's default `retries: 2`) never sees a rejection to
        // retry in the first place.
        inFlightJobs.delete(repoId);
      }
    });
  }

  private async runGeneration(repoId: string): Promise<void> {
    try {
      // AC-6: no usable index → no model call, nothing recorded.
      const indexState = await this.container.repoIntel.getIndexState(repoId);
      if (isIndexUnusable(indexState)) return;

      const repo = await this.container.reviewRepo.getRepo(repoId);
      if (!repo) {
        lastFailureReason.set(repoId, 'repo_not_found');
        return;
      }

      // AC-3: every generation input comes from `container.repoIntel` (the
      // repo-intel facade) or the clone on disk (`evidence.collectEvidence`)
      // — never a raw DB query or a re-parsed clone outside that seam.
      const [rankCandidates, criticalPaths, endpointFactRows, repoMap] = await Promise.all([
        this.container.repoIntel.getTopFilesByRank(repoId, RANK_COVERAGE_LIMIT),
        this.container.repoIntel.getCriticalPaths(repoId), // repo-intel's first caller
        this.container.repoIntel.getEndpointFacts(repoId, this.container.config.onboardingMaxEndpointFacts),
        this.container.repoIntel.getRepoMap(repoId, this.container.config.onboardingPromptTokenBudget),
      ]);
      // "getFileRank for exact ordering": re-derive the STORED order from the
      // authoritative percentile source rather than trusting
      // `getTopFilesByRank`'s incidental row order.
      const rankRows = await this.container.repoIntel.getFileRank(repoId, rankCandidates);
      const rank = [...rankRows].sort((a, b) => b.percentile - a.percentile).map((r) => r.path);

      const evidence = await collectEvidence(repo.clonePath, {
        maxExcerptFiles: this.container.config.onboardingMaxExcerptFiles,
        excerptCharCap: this.container.config.onboardingExcerptCharCap,
      });

      const endpointFacts = new Set<string>();
      for (const row of endpointFactRows) {
        for (const ep of row.endpoints) endpointFacts.add(ep);
      }

      // AC-4: workspace override, else the FEATURE_MODELS registry default.
      const { provider, model } = await resolveFeatureModel(this.container, repo.workspaceId, 'onboarding');
      const llm = await this.container.llm(provider);

      // First call anywhere in the codebase to render the onboarding system prompt template.
      const systemPrompt = await renderPrompt('onboarding.system.md', {
        sections: SECTION_KINDS.map((kind, i) => `${i + 1}. ${kind}`).join('\n'),
        language: this.container.config.onboardingLanguage,
      });

      // AC-12: every repository excerpt reaches the model wrapped in
      // `wrapUntrusted` — `renderFacts` does this for each key-file excerpt;
      // the repo map text is repository-derived too, so it gets the same
      // treatment here rather than being appended in the clear.
      const factsText = renderFacts({
        repoFullName: repo.fullName,
        excerpts: evidence.excerpts,
        commandAttestations: [...evidence.commandAttestations],
        endpointFacts: [...endpointFacts],
        criticalPaths,
      });
      const userMessage = repoMap.text
        ? `${factsText}\n\nRepository file map:\n${wrapUntrusted('repo-map', repoMap.text)}`
        : factsText;

      // AC-5, Rec-7: exactly ONE structured call; `maxRetries: 1` (never the
      // adapter's `?? 2` default) caps this at two provider calls total
      // (initial + one schema-repair reprompt the adapter owns internally —
      // this file adds no repair loop of its own).
      const result = await llm.completeStructured<OnboardingDraft>({
        model,
        schema: OnboardingDraft,
        schemaName: 'OnboardingDraft',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        maxRetries: 1,
        timeoutMs: this.container.config.onboardingGenerationTimeoutMs,
      });

      const sections = await groundTour(result.data, evidence, rank, endpointFacts, this.container.config);

      // AC-7: generate anyway from a partial/degraded index; record why.
      const degraded =
        indexState.status === 'partial' || indexState.status === 'degraded' || indexState.degraded === true;

      const payload: Onboarding = {
        sections,
        generated_at: new Date().toISOString(),
        indexed_revision: indexState.lastIndexedSha,
        indexed_file_count: indexState.filesIndexed,
        provider,
        model,
        degraded_reason: degraded ? (indexState.degradedReason ?? indexState.status) : null,
      };

      // AC-24 (via T7): replaces the single row for this repo.
      await this.repo.upsert(repoId, payload);
      lastFailureReason.delete(repoId);
    } catch (err) {
      // AC-28: nothing above this catch touched storage on this attempt, so
      // any previously stored tour is untouched by construction. Record the
      // reason for `getTour` to surface and — critically — do NOT rethrow:
      // see this file's header for why a throw here is a real cost bug, not
      // just a correctness one.
      lastFailureReason.set(repoId, err instanceof Error ? err.message : String(err));
    }
  }
}
