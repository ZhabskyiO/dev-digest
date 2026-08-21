/**
 * `BriefService` — orchestrates the PR Brief: read-time composition
 * (`getBrief`) and generation (`generate`, `summarizeChangedFilesForRun`).
 *
 * Onion rules: this file reaches other capabilities ONLY through
 * `container.*` (never `import { BlastService } from '../../blast/service.js'`
 * — see `container.blast`, the lazy facade the composition root exposes)
 * and through its own module's pure helpers (`compose.ts`, `summaries.ts`,
 * `evidence.ts`) / repository (`brief/repository.ts`). It never imports
 * `db/schema` or `drizzle-orm` directly.
 *
 * The brief is BUILT FROM ARTIFACTS, never from the raw diff. Generation
 * reads what the rest of the system already derived — the persisted intent
 * (`pr_intent`), the blast-radius map (the index), grouped diff stats over
 * `pr_files` (counts only), and the findings that already passed the
 * grounding gate — and hands those to `evidence.ts`, the one place that
 * renders the model's input. No `pr_files.patch` body is ever passed to a
 * model from this module: a mid-sized PR's diff alone is 5–15k tokens, and
 * the brief's whole input has to fit in ~8k.
 *
 * The two public entry points have very different cost profiles by design:
 *
 *  - `getBrief` is READ-ONLY and spends ZERO tokens (AC-9): every field is
 *    either a column already on the `pr_brief`/`pr_intent` rows, or composed
 *    live from `reviews`/`findings`/`pr_files` (pure functions in
 *    `compose.ts`) and from ONE `container.blast.blastForPull` call, which
 *    already carries `blast` + `status` + `reason` together
 *    (`BlastRadiusResult`). A re-index therefore flips `degraded` → `ready`
 *    on the very next read, with no regeneration (AC-13), and a review run
 *    that completes after generation shows up in `verdict_summary`/
 *    `review_focus` on the next read too (AC-49).
 *  - `generate` spends EXACTLY ONE model call — the batched per-file
 *    summaries (`completeStructured`, schema `FileSummaries`) — and persists
 *    ONLY the head sha, provenance and a counts-only record; never a blast
 *    snapshot, a verdict, or a review-focus list (AC-14). It NEVER re-derives
 *    the intent: the intent is an input artifact read from `pr_intent` as-is.
 *    Re-deriving it is `POST /pulls/:id/intent/recalculate`'s job
 *    (`ReviewService.recalculateIntent`), a separate, separately rate-limited
 *    endpoint — the brief must never spend that call on the caller's behalf.
 *    Generation reads the blast map BEST-EFFORT as evidence only: a failed or
 *    `degraded` read is reported to the model as such and can never stop a
 *    brief from being generated.
 */
import { z } from 'zod';
import type { Container } from '../../../platform/container.js';
import { RunLogger } from '../../../platform/run-logger.js';
import type { Logger } from '../run-executor.js';
import { renderPrompt } from '../../../platform/prompts.js';
import { AppError, NotFoundError, ExternalServiceError } from '../../../platform/errors.js';
import { resolveFeatureModel } from '../../settings/feature-models.js';
import type { PullRow, IntentRow } from '../repository.js';
import { findingsFromLatestRunPerAgent, findingRowToDto } from '../helpers.js';
import { BriefRepository } from './repository.js';
import {
  composeReviewFocus,
  aggregateVerdict,
  changedLinesFromPatches,
  type LatestAgentRun,
} from './compose.js';
import { selectFilesToSummarize, truncateSummary, type SummarizableFile } from './summaries.js';
import { renderBriefEvidence, type FindingHint } from './evidence.js';
import type {
  PrBriefDetail,
  Finding,
  Verdict,
  BlastRadiusResult,
} from '@devdigest/shared';

/** One `reviewsForPull` entry — derived from the method's own return type
 *  rather than importing `db/schema` directly, which would break this
 *  module's onion layering (same trick `modules/onboarding/service.ts` uses
 *  for `RepoRow`). */
type ReviewWithFindings = Awaited<ReturnType<Container['reviewRepo']['reviewsForPull']>>[number];

/** The matching Zod schema for `file-summaries.md`'s documented output shape
 *  (`{ summaries: [{ path, summary }] }`) — local to this module; nothing
 *  else needs a batched multi-file summary shape. */
const FileSummariesResult = z.object({
  summaries: z.array(z.object({ path: z.string(), summary: z.string() })),
});
type FileSummariesResult = z.infer<typeof FileSummariesResult>;

export interface GenerateOptions {
  /**
   * `false` (the default) makes generation IDEMPOTENT for the current head:
   * when a brief already exists for the PR's current `head_sha` it is
   * returned as-is with no model call. `true` regenerates regardless — the
   * Overview tab's `Regenerate` control sends `?force=true`.
   */
  force?: boolean;
}

/**
 * Everything the ONE model call reads, gathered in one place so a manual
 * regenerate (`doGenerate`) and the review-run hook
 * (`summarizeChangedFilesForRun`) can never drift on what "the artifacts"
 * are. Deliberately carries NO `patch` field — `PrFileRow.patch` is read by
 * `getBrief` for `changedLinesFromPatches` (a line-set, for review focus)
 * and nowhere else in this module.
 */
interface BriefArtifacts {
  files: SummarizableFile[];
  findings: Map<string, FindingHint[]>;
  intent: IntentRow | undefined;
  blast: BlastRadiusResult | null;
}

/** What `generateFileSummaries` hands back so `doGenerate` can persist the
 *  call's provenance and know how many summaries actually landed (for
 *  `PrBriefRecord.summarized_files`). Zeroed/nulled out on any failure or
 *  when there was nothing worth summarizing — the caller never has to branch
 *  on whether the call happened. */
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
   * `BriefService` is instantiated once at plugin scope but that is
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
    // re-index is reflected here with no regeneration (AC-13).
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
  // Generation — exactly one model call, one persisted write (AC-6, AC-14).
  // ---------------------------------------------------------------------

  /**
   * Generate the brief for one PR from its artifacts: ONE batched
   * `completeStructured` call for the per-file summaries, then ONE
   * `upsertBrief`. The intent is READ from `pr_intent`, never re-derived.
   *
   * `force: false` (default) short-circuits when a brief already exists for
   * the PR's current head — the empty-state `Generate brief` control is safe
   * to press twice. `force: true` regenerates unconditionally.
   *
   * Concurrent callers for the same PR share ONE derivation (AC-5) — same
   * dedupe shape as `IntentService.recalculate`. THROWS on model failure
   * (the route answers 502) and never touches the prior persisted row on
   * that path (AC-6).
   */
  async generate(
    workspaceId: string,
    prId: string,
    opts: GenerateOptions = {},
    logger?: Logger,
  ): Promise<PrBriefDetail> {
    // SECURITY: this ownership check MUST run before the `inFlight` map
    // lookup, and MUST NOT move below it. `inFlight` is keyed by `prId`
    // alone — it carries no workspace scoping — so a caller in workspace B
    // that joined the map FIRST would receive workspace A's full
    // `PrBriefDetail` (intent, blast paths, finding titles, cost) with no
    // ownership check ever having run for B. Resolving `pull`
    // workspace-scoped here, ahead of the map, and threading it into
    // `doGenerate` (which never re-resolves it) closes that window: a
    // foreign-workspace caller now throws `NotFoundError` right here, before
    // it ever touches the dedupe map or the in-flight promise. Mirrors
    // `ReviewService.recalculateIntent`, which resolves the pull's workspace
    // ownership before entering `IntentService.recalculate`'s own dedupe.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    if (!opts.force) {
      const existing = await this.briefRepo.getBriefRow(workspaceId, prId);
      if (existing && existing.headSha === pull.headSha) {
        logger?.info({ prId }, 'Brief already exists for the current head — returning it (no model call)');
        const detail = await this.getBrief(workspaceId, prId);
        if (detail) return detail;
      }
    }

    const joined = BriefService.inFlight.get(prId);
    if (joined) {
      logger?.info({ prId }, 'Brief generation already in flight for this PR — joining it');
      return joined;
    }
    const derivation = this.doGenerate(workspaceId, pull, logger).finally(() => {
      BriefService.inFlight.delete(prId);
    });
    BriefService.inFlight.set(prId, derivation);
    return derivation;
  }

  /**
   * Best-effort per-file summaries for one PR, hooked into a review run
   * (`run-executor.ts`) rather than a full `POST /brief/generate`. Gathers
   * the SAME artifacts `doGenerate` does (`collectArtifacts`) and delegates
   * to the still-private `generateFileSummaries` — the ONE place that owns
   * "at most 20 core/wiring files, one batched call" (AC-36). A run hook and
   * a manual brief regenerate must never fork that selection logic into two
   * places.
   *
   * WRITES `pr_file_summary` ONLY. Never creates or touches a `pr_brief`
   * row — doing so here would break AC-1 ("no brief yet" ⇒ `200` + `null`)
   * for a PR that has only ever been reviewed through a run, never briefed
   * via `POST /pulls/:id/brief/generate`. Do not "helpfully" call
   * `upsertBrief` from this method for any reason.
   *
   * NEVER THROWS. Every failure — a PR that can't be resolved in this
   * workspace, a DB error assembling the artifacts, or the model call itself
   * (already caught inside `generateFileSummaries`) — is caught HERE and
   * logged, so a run's per-file-summaries step can never fail the run it's
   * attached to. A caller's own try/catch around this call is belt-and-
   * braces, not load-bearing — this method's own catch is what actually
   * guarantees the run continues.
   */
  async summarizeChangedFilesForRun(workspaceId: string, prId: string, runLog: RunLogger): Promise<void> {
    try {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) {
        runLog.info('Brief file summaries (run hook): PR not found for this workspace — skipping');
        return;
      }

      const artifacts = await this.collectArtifacts(workspaceId, pull, runLog);

      // `generateFileSummaries` has its own try/catch and never throws;
      // this outer one exists for the assembly above (getPull/
      // collectArtifacts), none of which is otherwise guarded here.
      await this.generateFileSummaries(pull, artifacts, runLog);
    } catch (err) {
      runLog.error(
        `Brief file summaries (run hook) failed, run continues: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The artifacts one model call reads — see `BriefArtifacts`. Shared by
   * `doGenerate` and `summarizeChangedFilesForRun` so the two callers can
   * never drift on what evidence a summary is written from.
   *
   * The blast read is BEST-EFFORT: a throw is logged and yields `null`
   * (rendered as "unavailable" by `evidence.ts`), and a `degraded`/`partial`
   * result is passed through with its `reason` — the index being unusable
   * must never stop a brief from being generated (AC-14).
   */
  private async collectArtifacts(
    workspaceId: string,
    pull: PullRow,
    runLog: RunLogger,
  ): Promise<BriefArtifacts> {
    const [fileRows, reviews, intent, blast] = await Promise.all([
      this.repo.getPrFiles(pull.id),
      this.repo.reviewsForPull(pull.id),
      this.repo.getIntent(pull.id),
      this.container.blast.blastForPull(workspaceId, pull.id).catch((err: unknown) => {
        runLog.info(
          `Brief evidence: blast radius unavailable (brief still generates without it) — ${(err as Error).message}`,
        );
        return null;
      }),
    ]);

    // Counts only — `patch` is deliberately left behind here, the one
    // boundary that keeps a diff body out of the brief's model input.
    const files: SummarizableFile[] = fileRows.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    }));

    const findings = new Map<string, FindingHint[]>();
    for (const finding of findingsFromLatestRunPerAgent(reviews).map(findingRowToDto)) {
      const hint: FindingHint = { severity: finding.severity, title: finding.title, line: finding.start_line };
      const list = findings.get(finding.file);
      if (list) list.push(hint);
      else findings.set(finding.file, [hint]);
    }

    if (!intent) runLog.info('Brief evidence: no intent derived for this PR yet — generating without it');
    else if (intent.headSha !== pull.headSha) {
      runLog.info('Brief evidence: intent was derived at an earlier head — using it as-is (re-derive via /intent/recalculate)');
    }

    return { files, findings, intent, blast };
  }

  /**
   * `pull` is resolved and ownership-checked by the caller (`generate`,
   * ahead of its `inFlight` map lookup) — this method must never re-resolve
   * it itself, or it reopens the workspace-scope window `generate`'s
   * ordering closes.
   */
  private async doGenerate(workspaceId: string, pull: PullRow, logger?: Logger): Promise<PrBriefDetail> {
    const prId = pull.id;

    // No runIds → no SSE stream / no fake agent_run row, same shape as
    // `ReviewService.recalculateIntent`'s own RunLogger — the evidence lines
    // still reach the server's structured stdout logger.
    const runLog = new RunLogger(this.container.runBus, [], logger, { prId });

    const artifacts = await this.collectArtifacts(workspaceId, pull, runLog);

    // ---- THE model call: batched file summaries from the artifacts -----
    // Throws through `generateFileSummaries`' `rethrow` so the route can
    // answer 502 instead of silently persisting a brief with no summaries
    // behind a manual, single-PR generation. A run hook keeps the
    // best-effort swallow (D5: the review must never fail over enrichment).
    const summaries = await this.generateFileSummaries(pull, artifacts, runLog, { rethrow: true });

    // ---- ONE write, at the very end (AC-6) ----------------------------
    // Counts only — never a blast snapshot, a verdict, or a review-focus
    // list (AC-14/AC-49): this call's `json` is typed `PrBriefRecord`, which
    // is structurally incapable of carrying any of those.
    await this.briefRepo.upsertBrief(pull.id, {
      headSha: pull.headSha,
      provider: summaries.provider,
      model: summaries.model,
      tokensIn: summaries.tokensIn,
      tokensOut: summaries.tokensOut,
      costUsd: summaries.costUsd,
      json: { summarized_files: summaries.summarizedCount, changed_files: artifacts.files.length },
    });

    runLog.result(
      `Brief generated for PR #${pull.number} — ${summaries.summarizedCount}/${artifacts.files.length} files summarized`,
    );

    // Compose the response through the same read path GET uses.
    const detail = await this.getBrief(workspaceId, prId);
    if (!detail) throw new ExternalServiceError('Brief was generated but could not be read back');
    return detail;
  }

  /**
   * The brief's ONE model call: `selectFilesToSummarize` (at most 20, AC-36)
   * → `renderBriefEvidence` (artifacts only, never a patch) → ONE batched
   * `completeStructured` call → `truncateSummary` each reply → drop any path
   * the model returned that wasn't asked for → ONE `upsertFileSummaries`
   * write. NEVER fans out per file.
   *
   * Failure handling is the caller's choice: by default every failure
   * (model call, schema validation inside the adapter, network) is caught
   * HERE and logged so a review run is never failed by enrichment;
   * `rethrow: true` (manual generation) surfaces it as an
   * `ExternalServiceError` instead, leaving any prior brief untouched.
   */
  private async generateFileSummaries(
    pull: PullRow,
    artifacts: BriefArtifacts,
    runLog: RunLogger,
    opts: { rethrow?: boolean } = {},
  ): Promise<FileSummariesOutcome> {
    const findingCounts = new Map<string, number>();
    for (const [path, hints] of artifacts.findings) findingCounts.set(path, hints.length);

    const selected = selectFilesToSummarize(artifacts.files, findingCounts);
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

      const intentRow = artifacts.intent;
      const evidence = renderBriefEvidence({
        title: pull.title,
        intent: intentRow
          ? {
              intent: intentRow.intent,
              in_scope: intentRow.inScope,
              out_of_scope: intentRow.outOfScope,
              risk_areas: intentRow.riskAreas,
            }
          : null,
        intentIsCurrent: intentRow?.headSha === pull.headSha,
        blast: artifacts.blast,
        files: artifacts.files,
        selected,
        findings: artifacts.findings,
      });

      const prompt = await renderPrompt('file-summaries.md', {
        count: String(selected.length),
        context: evidence.context,
        files: evidence.files,
      });

      const res = await llm.completeStructured<FileSummariesResult>({
        model,
        schema: FileSummariesResult,
        schemaName: 'FileSummaries',
        messages: [{ role: 'user', content: prompt }],
      });

      // Model output is untrusted: a reply naming a path outside the
      // selected set is dropped rather than persisted (never invent a
      // `pr_file_summary` row for a file we didn't ask about). The prompt
      // only *asks* for one entry per file — it does not guarantee one — so
      // a duplicate `path` is also de-duplicated here, keeping the first
      // occurrence: `upsertFileSummaries` does a multi-row
      // `INSERT ... ON CONFLICT (pr_id, path) DO UPDATE`, and Postgres
      // raises 21000 ("ON CONFLICT DO UPDATE command cannot affect row a
      // second time") if two rows in the same statement share a conflict
      // key, aborting the whole upsert.
      const selectedPaths = new Set(selected.map((c) => c.path));
      const seenPaths = new Set<string>();
      const rows = res.data.summaries
        .filter((s) => selectedPaths.has(s.path))
        .filter((s) => {
          if (seenPaths.has(s.path)) return false;
          seenPaths.add(s.path);
          return true;
        })
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
      const message = (err as Error).message;
      if (opts.rethrow) {
        // An `AppError` already carries its own status — a `ConfigError`
        // from `resolveFeatureModel`/`container.llm` (no key, unknown model)
        // must stay a 500, not masquerade as an upstream-provider 502.
        if (err instanceof AppError) throw err;
        throw new ExternalServiceError(`Brief generation failed: ${message}`);
      }
      // Best-effort (run hook): logged and the run continues without
      // summaries — it must never fail the review it's attached to.
      runLog.error(`Brief file summaries failed (run continues without them): ${message}`);
      return NO_SUMMARIES;
    }
  }
}
