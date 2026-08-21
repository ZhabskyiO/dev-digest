/**
 * `BriefService` — orchestrates the PR Brief: read-time composition
 * (`getBrief`) and generation (`generate`, `generateFileSummaries`).
 *
 * Onion rules: this file reaches other capabilities ONLY through
 * `container.*` (never `import { BlastService } from '../../blast/service.js'`
 * — see `container.blast`, the lazy facade T12 adds to the composition
 * root) and through its own module's pure helpers (`compose.ts`,
 * `summaries.ts`) / repository (`brief/repository.ts`). It never imports
 * `db/schema` or `drizzle-orm` directly.
 *
 * The two public entry points have very different cost profiles by design:
 *
 *  - `getBrief` is READ-ONLY and spends ZERO tokens (AC-9): every field is
 *    either a column already on the `pr_brief`/`pr_intent` rows, or composed
 *    live from `reviews`/`findings`/`pr_files` (pure functions in
 *    `compose.ts`) and from ONE `container.blast.blastForPull` call, which
 *    already carries `blast` + `status` + `reason` together
 *    (`BlastRadiusResult`). `container.blast` is referenced ONLY here, never
 *    from `generate`/`generateFileSummaries` — a re-index therefore flips
 *    `degraded` → `ready` on the very next read, with no regeneration
 *    (AC-13), and a review run that completes after generation shows up in
 *    `verdict_summary`/`review_focus` on the next read too (AC-49).
 *  - `generate` spends up to TWO model calls (a forced intent re-derive, then
 *    a best-effort batched file-summaries call) and persists ONLY the head
 *    sha, provenance and a counts-only record — never a blast snapshot, a
 *    verdict, or a review-focus list (AC-14). It never reads
 *    `container.blast` at all: the index being unusable must never stop a
 *    brief from being generated.
 */
import { z } from 'zod';
import type { Container } from '../../../platform/container.js';
import { RunLogger } from '../../../platform/run-logger.js';
import type { Logger } from '../run-executor.js';
import { renderPrompt } from '../../../platform/prompts.js';
import { wrapUntrusted } from '../../../platform/prompt.js';
import { NotFoundError, ExternalServiceError } from '../../../platform/errors.js';
import { resolveFeatureModel } from '../../settings/feature-models.js';
import type { PullRow } from '../repository.js';
import { findingsFromLatestRunPerAgent, findingRowToDto } from '../helpers.js';
import { IntentService } from '../intent/service.js';
import { BriefRepository } from './repository.js';
import {
  composeReviewFocus,
  aggregateVerdict,
  changedLinesFromPatches,
  type LatestAgentRun,
} from './compose.js';
import { selectFilesToSummarize, truncateSummary } from './summaries.js';
import type { PrBriefDetail, Finding, Verdict } from '@devdigest/shared';

/** One `pr_files` row, as `container.reviewRepo.getPrFiles` returns it — no
 *  exported alias exists on `ReviewRepository` for the element type, so this
 *  is derived from the method's own return type (same trick
 *  `modules/onboarding/service.ts` uses for `RepoRow`) rather than importing
 *  `db/schema` directly, which would break this module's onion layering. */
type PrFileRow = Awaited<ReturnType<Container['reviewRepo']['getPrFiles']>>[number];

/** One `reviewsForPull` entry — same derivation trick as `PrFileRow` above. */
type ReviewWithFindings = Awaited<ReturnType<Container['reviewRepo']['reviewsForPull']>>[number];

/** The matching Zod schema for `file-summaries.md`'s documented output shape
 *  (`{ summaries: [{ path, summary }] }`) — local to this module; nothing
 *  else needs a batched multi-file summary shape. */
const FileSummariesResult = z.object({
  summaries: z.array(z.object({ path: z.string(), summary: z.string() })),
});
type FileSummariesResult = z.infer<typeof FileSummariesResult>;

/** What `generateFileSummaries` hands back so `generate` can fold its
 *  tokens/cost into the brief's totals and know how many summaries actually
 *  landed (for `PrBriefRecord.summarized_files`). Zeroed/nulled out on any
 *  failure or when there was nothing worth summarizing — the caller never
 *  has to branch on whether the call happened. */
interface FileSummariesOutcome {
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  provider: string | null;
  model: string | null;
  /** Rows actually written to `pr_file_summary` — after dropping any path
   *  the model returned that wasn't in the selected set. */
  summarizedCount: number;
}

const NO_SUMMARIES: FileSummariesOutcome = {
  tokensIn: 0,
  tokensOut: 0,
  costUsd: null,
  provider: null,
  model: null,
  summarizedCount: 0,
};

/**
 * The latest review per agent (same newest-first dedupe policy as
 * `findingsFromLatestRunPerAgent` in `../helpers.js`) that actually carries a
 * verdict, shaped for `compose.ts::aggregateVerdict`.
 *
 * A `kind: 'summary'` review has `verdict: null` — it contributes findings
 * via `findingsFromLatestRunPerAgent` but must never cast a PR-level vote.
 * Dedup happens BEFORE the verdict check so an agent's newest run (even a
 * verdict-less one) still supersedes its own older, verdict-carrying run —
 * exactly the semantics `findingsFromLatestRunPerAgent` already applies to
 * findings.
 */
function latestVerdictRunsPerAgent(rows: readonly ReviewWithFindings[]): LatestAgentRun[] {
  const seen = new Set<string>();
  const out: LatestAgentRun[] = [];
  for (const { review, findings } of rows) {
    const key = review.agentId ?? `review:${review.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!review.verdict) continue;
    out.push({
      verdict: review.verdict as Verdict,
      score: review.score,
      findings: findings.map((f) => ({ severity: f.severity as Finding['severity'] })),
    });
  }
  return out;
}

export class BriefService {
  private repo: Container['reviewRepo'];
  private briefRepo: BriefRepository;

  /**
   * In-flight `generate` derivations, keyed by `pr_id`. MUST be `static` —
   * `BriefService` is instantiated once at plugin scope (T13) but that is
   * incidental; an instance field would dedupe nothing if a caller ever
   * constructed a second instance, exactly the reasoning
   * `IntentService.inFlight`'s own comment gives. Entries are always removed
   * in a `finally`, so this cannot leak.
   */
  private static readonly inFlight = new Map<string, Promise<PrBriefDetail>>();

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
    this.briefRepo = new BriefRepository(container.db);
  }

  /**
   * Per-file summaries for `prId`, filtered to rows derived from `headSha` —
   * a thin passthrough to `BriefRepository.getFileSummaries`, the ONE public
   * way another module (e.g. `ReviewService.smartDiffForPull`'s Smart Diff
   * assembly) may reach this data. `BriefRepository` stays internal to this
   * module (see `brief/index.ts`'s barrel comment) — callers outside this
   * module must go through this method, never construct `BriefRepository`
   * themselves.
   *
   * The head-sha predicate that makes AC-38 unforgeable lives ENTIRELY in
   * the repository's query (see `BriefRepository.getFileSummaries`'s own
   * doc comment) — callers MUST NOT re-filter the returned map by head sha
   * in application code; pass the PR's current `head_sha` in here and trust
   * the empty-map result for a moved head.
   */
  async getFileSummaries(prId: string, headSha: string): Promise<Map<string, string>> {
    return this.briefRepo.getFileSummaries(prId, headSha);
  }

  // ---------------------------------------------------------------------
  // Read path — zero model calls (AC-9).
  // ---------------------------------------------------------------------

  /**
   * The brief for a PR, or `null` when none has been generated yet (or the
   * PR isn't in this workspace — the two are indistinguishable on purpose,
   * same as `BriefRepository.getBriefRow`'s own doc comment).
   */
  async getBrief(workspaceId: string, prId: string): Promise<PrBriefDetail | null> {
    const row = await this.briefRepo.getBriefRow(workspaceId, prId);
    if (!row) return null;

    // ONE blast call — carries `blast` + `status` + `reason` together, so a
    // re-index is reflected here with no regeneration (AC-13). Never call
    // `container.blast` anywhere else in this class.
    const [blast, reviews, files, intent] = await Promise.all([
      this.container.blast.blastForPull(workspaceId, prId),
      this.repo.reviewsForPull(prId),
      this.repo.getPrFiles(prId),
      this.repo.getIntentDetail(workspaceId, prId),
    ]);

    const changedLines = changedLinesFromPatches(
      files.map((f) => ({ path: f.path, patch: f.patch })),
    );
    const latestFindings = findingsFromLatestRunPerAgent(reviews).map(findingRowToDto);
    const reviewFocus = composeReviewFocus(latestFindings, changedLines);
    const verdictSummary = aggregateVerdict(latestVerdictRunsPerAgent(reviews));

    return {
      pr_id: prId,
      head_sha: row.headSha,
      status: blast.status,
      reason: blast.reason,
      intent: intent ?? null,
      blast,
      verdict_summary: verdictSummary,
      review_focus: reviewFocus,
      cost_usd: row.costUsd,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      generated_at: row.generatedAt.toISOString(),
      summarized_files: row.json.summarized_files,
      changed_files: row.json.changed_files,
    };
  }

  // ---------------------------------------------------------------------
  // Generation — up to two model calls, one persisted write (AC-6, AC-14).
  // ---------------------------------------------------------------------

  /**
   * Force a fresh brief for one PR: re-derive intent (model call 1), then
   * best-effort per-file summaries (model call 2), then ONE `upsertBrief`.
   *
   * Concurrent callers for the same PR share ONE derivation (AC-5) — same
   * dedupe shape as `IntentService.recalculate`. THROWS on intent failure
   * (the route answers 502); a file-summaries failure is swallowed inside
   * `generateFileSummaries` and never reaches here, so it can never abort
   * generation or touch the prior persisted row.
   */
  async generate(workspaceId: string, prId: string, logger?: Logger): Promise<PrBriefDetail> {
    const joined = BriefService.inFlight.get(prId);
    if (joined) {
      logger?.info({ prId }, 'Brief generation already in flight for this PR — joining it');
      return joined;
    }
    const derivation = this.doGenerate(workspaceId, prId, logger).finally(() => {
      BriefService.inFlight.delete(prId);
    });
    BriefService.inFlight.set(prId, derivation);
    return derivation;
  }

  /**
   * Best-effort per-file summaries for one PR, hooked into a review run
   * (T15's `run-executor.ts`) rather than a full `POST /brief/generate`.
   * Assembles the SAME inputs `doGenerate` does and delegates to the still
   * private `generateFileSummaries` — the ONE place that owns "at most 20
   * core/wiring files, one batched call" (AC-36). A run hook and a manual
   * brief regenerate must never fork that selection logic into two places.
   *
   * WRITES `pr_file_summary` ONLY. Never creates or touches a `pr_brief`
   * row — doing so here would break AC-1 ("no brief yet" ⇒ `200` + `null`)
   * for a PR that has only ever been reviewed through a run, never briefed
   * via `POST /pulls/:id/brief/generate`. Do not "helpfully" call
   * `upsertBrief` from this method for any reason.
   *
   * Never reads `container.blast` (consistent with `generate`/`doGenerate`
   * — a run hook has even less reason to touch the index than a manual
   * brief regenerate does).
   *
   * NEVER THROWS. Every failure — a PR that can't be resolved in this
   * workspace, a DB error assembling `files`/`findingCounts`, or the model
   * call itself (already caught inside `generateFileSummaries`) — is caught
   * HERE and logged, so a run's per-file-summaries step can never fail the
   * run it's attached to. A caller's own try/catch around this call (T15
   * mirrors the existing intent-derivation step, which wraps its own call
   * in one) is belt-and-braces, not load-bearing — this method's own catch
   * is what actually guarantees the run continues.
   */
  async summarizeChangedFilesForRun(workspaceId: string, prId: string, runLog: RunLogger): Promise<void> {
    try {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) {
        runLog.info('Brief file summaries (run hook): PR not found for this workspace — skipping');
        return;
      }

      const files = await this.repo.getPrFiles(pull.id);
      const findingCounts = await this.collectFindingCounts(pull.id);

      // `generateFileSummaries` has its own try/catch and never throws;
      // this outer one exists for the assembly above (getPull/getPrFiles/
      // collectFindingCounts), none of which is otherwise guarded here.
      await this.generateFileSummaries(pull, files, findingCounts, runLog);
    } catch (err) {
      runLog.error(
        `Brief file summaries (run hook) failed, run continues: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Per-path finding counts from the PR's current latest-per-agent findings
   * — the ranking input `selectFilesToSummarize` needs. Shared by
   * `doGenerate` and `summarizeChangedFilesForRun` so the two callers can
   * never drift on how a "risky file" is counted.
   */
  private async collectFindingCounts(prId: string): Promise<ReadonlyMap<string, number>> {
    const reviews = await this.repo.reviewsForPull(prId);
    const findingCounts = new Map<string, number>();
    for (const finding of findingsFromLatestRunPerAgent(reviews)) {
      findingCounts.set(finding.file, (findingCounts.get(finding.file) ?? 0) + 1);
    }
    return findingCounts;
  }

  private async doGenerate(
    workspaceId: string,
    prId: string,
    logger?: Logger,
  ): Promise<PrBriefDetail> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // No runIds → no SSE stream / no fake agent_run row, same shape as
    // `ReviewService.recalculateIntent`'s own RunLogger — the evidence lines
    // still reach the server's structured stdout logger.
    const runLog = new RunLogger(this.container.runBus, [], logger, { prId });

    // ---- model call 1: forced intent re-derive ------------------------
    // THROWS on failure — this is what lets the route answer 502 instead of
    // silently keeping a stale brief. D5 ("intent can never fail a review")
    // does not apply to a manual, single-PR generation.
    await new IntentService(this.container).recalculate(workspaceId, pull, repo, runLog);
    // Read back the just-persisted provenance for this call's tokens/cost —
    // `recalculate` returns only the prompt-slot shape, not provenance.
    const intentRow = await this.repo.getIntent(pull.id);

    const files = await this.repo.getPrFiles(pull.id);
    const findingCounts = await this.collectFindingCounts(pull.id);

    // ---- model call 2: best-effort file summaries ---------------------
    const summaries = await this.generateFileSummaries(pull, files, findingCounts, runLog);

    // ---- costs: sum of the non-null costs of the calls actually made ---
    const tokensIn = (intentRow?.tokensIn ?? 0) + summaries.tokensIn;
    const tokensOut = (intentRow?.tokensOut ?? 0) + summaries.tokensOut;
    const costs = [intentRow?.costUsd, summaries.costUsd].filter(
      (c): c is number => c !== null && c !== undefined,
    );
    const costUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;
    // Provider/model is a single pair on `pr_brief` even though the two
    // calls resolve independent Settings entries (`review_intent`,
    // `risk_brief`) and may legitimately differ. The summaries call is what
    // `risk_brief` names, so it wins when it ran; the intent call's
    // provider/model is the fallback so the column is never both-null when
    // at least one call actually spent tokens (intent's own choice is also
    // recorded separately on `pr_intent`).
    const provider = summaries.provider ?? intentRow?.provider ?? null;
    const model = summaries.model ?? intentRow?.model ?? null;

    // ---- ONE write, at the very end (AC-6) ----------------------------
    // Counts only — never a blast snapshot, a verdict, or a review-focus
    // list (AC-14/AC-49): this call's `json` is typed `PrBriefRecord`, which
    // is structurally incapable of carrying any of those.
    await this.briefRepo.upsertBrief(pull.id, {
      headSha: pull.headSha,
      provider,
      model,
      tokensIn,
      tokensOut,
      costUsd,
      json: { summarized_files: summaries.summarizedCount, changed_files: files.length },
    });

    runLog.result(
      `Brief generated for PR #${pull.number} — ${summaries.summarizedCount}/${files.length} files summarized`,
    );

    // Compose the response through the same read path GET uses (blast is
    // read here for the FIRST time in this whole call — see this class's
    // header comment for why that split matters).
    const detail = await this.getBrief(workspaceId, prId);
    if (!detail) throw new ExternalServiceError('Brief was generated but could not be read back');
    return detail;
  }

  /**
   * Best-effort per-file summaries: `selectFilesToSummarize` (at most 20,
   * AC-36) → ONE batched `completeStructured` call → `truncateSummary` each
   * reply → drop any path the model returned that wasn't asked for → ONE
   * `upsertFileSummaries` write. NEVER fans out per file.
   *
   * Every failure (model call, schema validation inside the adapter,
   * network) is caught HERE and logged — never rethrown — so a summaries
   * failure can never abort `generate` or touch a prior brief.
   */
  private async generateFileSummaries(
    pull: PullRow,
    files: readonly PrFileRow[],
    findingCounts: ReadonlyMap<string, number>,
    runLog: RunLogger,
  ): Promise<FileSummariesOutcome> {
    const selected = selectFilesToSummarize(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      findingCounts,
    );
    if (selected.length === 0) {
      runLog.info('Brief file summaries: no core/wiring files to summarize — skipping the model call');
      return NO_SUMMARIES;
    }

    try {
      const { provider, model } = await resolveFeatureModel(
        this.container,
        pull.workspaceId,
        'risk_brief',
      );
      const llm = await this.container.llm(provider);

      const patchByPath = new Map(files.map((f) => [f.path, f.patch] as const));
      const filesBlock = selected
        .map((candidate) => {
          const patch = patchByPath.get(candidate.path);
          const content = patch && patch.length > 0 ? patch : '(no patch available for this file)';
          return `path: ${candidate.path}\n${wrapUntrusted(`diff:${candidate.path}`, content)}`;
        })
        .join('\n\n');

      const prompt = await renderPrompt('file-summaries.md', {
        count: String(selected.length),
        files: filesBlock,
      });

      const res = await llm.completeStructured<FileSummariesResult>({
        model,
        schema: FileSummariesResult,
        schemaName: 'FileSummaries',
        messages: [{ role: 'user', content: prompt }],
      });

      // Model output is untrusted: a reply naming a path outside the
      // selected set is dropped rather than persisted (never invent a
      // `pr_file_summary` row for a file we didn't ask about).
      const selectedPaths = new Set(selected.map((c) => c.path));
      const rows = res.data.summaries
        .filter((s) => selectedPaths.has(s.path))
        .map((s) => ({ path: s.path, summary: truncateSummary(s.summary) }));

      await this.briefRepo.upsertFileSummaries(pull.id, pull.headSha, rows);

      runLog.result(
        `Brief file summaries: ${rows.length}/${selected.length} files via ${provider}/${model}`,
      );

      return {
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        provider,
        model,
        summarizedCount: rows.length,
      };
    } catch (err) {
      // Best-effort, per the spec's "partially succeeds" edge case: a
      // failure here is logged and leaves the brief without summaries — it
      // must never fail the whole generation.
      runLog.error(
        `Brief file summaries failed (brief still generates without them): ${(err as Error).message}`,
      );
      return NO_SUMMARIES;
    }
  }
}
