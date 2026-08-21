import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import {
  buildCallersDigest,
  buildRepoMapDigest,
  buildRankNote,
  resolveAgentSkills,
  resolveProjectContext,
} from './prompt-context.js';
import { IntentService, type PromptIntentSlot } from './intent/service.js';
import { BriefService } from './brief/index.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  private intentService: IntentService;
  private briefService: BriefService;

  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {
    this.intentService = new IntentService(container);
    this.briefService = new BriefService(container);
  }

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        // Trace first, terminal status second — same barrier as the success
        // path: `failed` in `agent_runs` must never be visible before the
        // trace explaining the failure is readable.
        await this.repo
          // No `skillBodies` in scope here on purpose: this is the PRE-WORK
          // failure path (diff load itself failed) — execution never reached
          // per-agent processing, so no skill was ever resolved or attached.
          // `skills: null` in traceFromBuffer's default is accurate, not a gap.
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            // Explicitly null, not 0 — a run that never reached the model has no
            // cost, and the UI must render `—` rather than a misleading `$0.00`.
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // Derive intent ONCE per executeRuns (shared across every queued agent),
    // exactly like the diff above — not per agent inside runOneAgent, or N
    // agents would each pay for a derivation and their Live Logs would
    // diverge. `deriveForRun` already swallows every internal failure and
    // returns `undefined` (D5); this try/catch is defense in depth so that
    // even an unexpected throw here can NEVER reach `failAll` below, which
    // would fail every queued run in this batch for what is an optional
    // enrichment, not the review itself.
    let intentSlot: PromptIntentSlot | undefined;
    try {
      intentSlot = await runLog.step(
        'Deriving PR intent',
        () => this.intentService.deriveForRun(workspaceId, pull, repo, runLog),
        { kind: 'tool' },
      );
    } catch (err) {
      runLog.info(`Intent derivation step threw unexpectedly (ignored): ${(err as Error).message}`);
      intentSlot = undefined;
    }

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(workspaceId, pull, repo, diff, intentSlot, agent, runId, runLog);
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }

    // T15 — per-file summaries (AC-31), derived ONCE per executeRuns, exactly
    // like intent above and for the same reason: it's shared across every
    // queued agent in this batch, not per-agent state. Placed AFTER the loop
    // (not before it, alongside diff/intent) so it never delays any agent's
    // review behind an optional model call. `summarizeChangedFilesForRun`
    // already swallows every internal failure and returns normally (D5); this
    // try/catch is defense in depth so that even an unexpected throw here can
    // NEVER reach `failAll` above, which would fail every queued run in this
    // batch for what is an optional enrichment, not the review itself.
    try {
      await runLog.step(
        'Summarizing changed files',
        () => this.briefService.summarizeChangedFilesForRun(workspaceId, pull.id, runLog),
        { kind: 'tool' },
      );
    } catch (err) {
      runLog.info(`File summaries step threw unexpectedly (ignored): ${(err as Error).message}`);
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    intent: PromptIntentSlot | undefined,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    // Hoisted out of the try block (not `const` inside it) so the catch
    // block below can still see whatever was resolved before the failure —
    // in particular, the "Loading skills" step may have already run (and
    // already written `run_skills`) by the time a LATER step throws.
    let skillBodies: string[] = [];

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await buildCallersDigest(this.container, pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn
        ? await buildRepoMapDigest(this.container, pull.repoId, runLog)
        : undefined;
      const rankNote = repoIntelOn
        ? await buildRankNote(this.container, pull.repoId, diff, runLog)
        : '';

      const task = taskLine(pull) + rankNote;

      // Skills — this agent's linked skills, still in `order`, filtered to
      // enabled === true. BOTH gates must hold (attached to this agent AND
      // globally enabled) — that's what makes an unvetted/disabled import
      // inert without unlinking it. The resolved ordered list is already in
      // hand here, so the per-run attribution write (`run_skills`) happens in
      // the same step as a single bulk insert.
      skillBodies = await runLog.step(
        'Loading skills',
        async () => {
          const { bodies, ids, linkedCount } = await resolveAgentSkills(this.container, agent.id);
          await this.container.skillsRepo.recordRunSkills(runId, ids);
          runLog.info(`skills: ${ids.length}/${linkedCount} linked skill(s) enabled and attached`);
          return bodies;
        },
        { kind: 'tool' },
      );

      // T17 — project context (AC-20, AC-29, AC-30). Resolves the agent's
      // effective attachment set into ordered document bodies for the
      // prompt's `## Project context` slot, plus the paths actually
      // injected (`specsRead`) and a per-document outcome for the trace
      // (`details`). `resolveProjectContext` never throws (best-effort,
      // same contract as every other builder in this file), so no
      // try/catch here — one would only mask a genuine bug.
      const projectContext = await runLog.step(
        'Loading project context',
        () => resolveProjectContext(this.container, agent.id, repo.id, runLog),
        { kind: 'tool' },
      );

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // L02 — linked, enabled skill bodies (already ordered). Same
        // omit-when-empty contract as callers/repoMap.
        ...(skillBodies.length ? { skills: skillBodies } : {}),
        // T17 — attached project-context document bodies (already ordered).
        // Same omit-when-empty contract: an empty array must NOT be passed,
        // or the byte-identical-prompt guarantee for a run with no attached
        // context (AC-26) breaks.
        ...(projectContext.bodies.length ? { specs: projectContext.bodies } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // L03 — derived PR intent, once per executeRuns. INTENT_IN_PROMPT is
        // the A/B lever for the confirmation-bias risk (plan R-1): when
        // false, intent is still derived/persisted/served to the UI, but the
        // slot is withheld here so the prompt is unaffected.
        ...(intent && this.container.config.intentInPromptEnabled ? { intent } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      // `costUsd` is the REAL billed cost when the provider reports one
      // (OpenRouter's `usage.cost`), else priced from tokens, else null.
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      const keptFindings = outcome.review.findings;

      // ---- Persist review + findings ----------------------------------------
      const review = await this.repo.insertReview({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        runId,
        kind: 'review',
        verdict: outcome.review.verdict,
        summary: outcome.review.summary,
        score: outcome.review.score,
        model: agent.model,
      });
      const findingRows = await this.repo.insertFindings(review.id, keptFindings);
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // Mark the commit this review ran against so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.repo.markReviewed(pull.id, pull.headSha);

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Observability: ONE run_traces document, THEN agent_runs --------
      // Order matters and is load-bearing: the terminal status in `agent_runs`
      // is the barrier everything else waits on (tests poll it; tooling treats
      // done/failed as "this run's record is complete"). Writing it before the
      // trace document opens a window where a run reads as finished but
      // `GET /runs/:id/trace` still 404s. Persist the trace first so terminal
      // status always means the trace is readable.
      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
        },
        prompt_assembly: outcome.assembly,
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        // AC-30 — the documents actually injected, in order (not the whole
        // effective set; the per-document detail array below carries the
        // omissions).
        specs_read: projectContext.specsRead,
        // AC-29 — per-document outcome (injected / missing /
        // dropped_over_budget / truncated / wrong_repo / changed_unconfirmed)
        // for every document in the effective context set.
        project_context: projectContext.details,
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);

      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        costUsd,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        error: null,
      });
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      // Trace first, terminal status second — see the success path.
      await this.repo
        .saveRunTrace(
          runId,
          // `skillBodies` may already be populated here — the "Loading skills"
          // step (and its run_skills write) can have completed before a LATER
          // step (e.g. the LLM call) threw. Thread it through so the trace
          // reflects what was actually attached, not a blanket null.
          this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start, skillBodies),
        )
        .catch(() => undefined);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          // Explicitly null, not 0 — a failed/cancelled run may still have burned
          // tokens, but we have no trustworthy cost for it. `—`, not `$0.00`.
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
    // Skill bodies already resolved before the failure, if any (empty for the
    // pre-work failAll path, where no per-agent step ever ran). Joined the
    // same way assemblePrompt joins them, for consistency in the trace UI.
    skillBodies: string[] = [],
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      // cost_usd null (not 0): this trace is built for runs that never produced
      // a priced outcome, so the drawer must show `—`.
      stats: {
        duration_ms: durationMs,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: null,
        findings: 0,
        grounding,
      },
      prompt_assembly: {
        system: agent.systemPrompt,
        skills: skillBodies.length ? skillBodies.join('\n\n') : null,
        memory: null,
        specs: null,
        user: '',
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
