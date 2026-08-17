import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { CiFailOn, Provider } from './knowledge.js';

/**
 * Local review contracts — reviewing a diff that has no pull request behind it
 * (`POST /reviews/local`, driven by the `devdigest review` CLI).
 *
 * The SAME reviewer runs: the request carries a raw unified diff instead of a
 * `pr_id`, and the server parses it, resolves the agent exactly as a PR run
 * does, and calls `reviewPullRequest` from `@devdigest/reviewer-core`. What it
 * deliberately does NOT do is persist: there is no PR row to hang a review,
 * findings, or an `agent_runs` row off, so the result is returned inline and
 * nothing is written.
 *
 * Request fields are camelCase (like `RunRequest`); response fields are
 * snake_case (like `ReviewRecord`).
 */

/**
 * Which local change-set was diffed. Only `working` is implemented today; the
 * other two are named here so the CLI's `--mode` flag and this contract agree
 * on the vocabulary before the server grows the code paths.
 *
 *  - `working` — working tree vs HEAD (staged + unstaged tracked changes)
 *  - `staged`  — index vs HEAD                       (not implemented yet)
 *  - `branch`  — the branch vs its merge base        (not implemented yet)
 */
export const LocalReviewMode = z.enum(['working', 'staged', 'branch']);
export type LocalReviewMode = z.infer<typeof LocalReviewMode>;

/** Modes the server will actually run. Anything else is rejected with a 400. */
export const IMPLEMENTED_LOCAL_REVIEW_MODES: readonly LocalReviewMode[] = ['working'];

export const LocalReviewRequest = z.object({
  /** Which local change-set the diff came from. */
  mode: LocalReviewMode,
  /** The unified diff to review (new-side line numbers; as `git diff` emits). */
  diff: z.string().min(1),
  /** Agent to run. Omitted → the workspace's single enabled agent, if there is exactly one. */
  agentId: z.string().uuid().optional(),
  /**
   * `owner/name` of an imported repo. Purely an enrichment hint: when it
   * resolves to an INDEXED repo the prompt gets the same repo-intel context a
   * PR review would (repo map, callers of changed symbols, hot-file rank note).
   * Unknown or unindexed → the review still runs, diff-only, and says so in
   * `degraded`.
   */
  repo: z.string().max(200).optional(),
  /** Override the agent's `ci_fail_on` gate for this run only. */
  failOn: CiFailOn.optional(),
  /** Human label for the change-set, e.g. `working tree @ 1ba9516`. Prompt-visible. */
  label: z.string().max(300).optional(),
});
export type LocalReviewRequest = z.infer<typeof LocalReviewRequest>;

/** Severity histogram over the kept (grounded) findings. */
export const LocalReviewCounts = z.object({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type LocalReviewCounts = z.infer<typeof LocalReviewCounts>;

export const LocalReviewAgent = z.object({
  id: z.string(),
  name: z.string(),
  provider: Provider,
  model: z.string(),
});
export type LocalReviewAgent = z.infer<typeof LocalReviewAgent>;

export const LocalReviewResult = z.object({
  mode: LocalReviewMode,
  agent: LocalReviewAgent,
  /** Number of files in the parsed diff. */
  files: z.number().int(),
  verdict: Verdict,
  summary: z.string(),
  score: z.number().int(),
  /** Citation-gate summary, e.g. `3/4 passed`. */
  grounding: z.string(),
  counts: LocalReviewCounts,
  /** The gate actually applied (request override, else the agent's own). */
  fail_on: CiFailOn,
  /** Findings at or above the gate — the deterministic blocking signal. */
  blockers: z.number().int(),
  /** `blockers > 0`. The CLI's non-zero-exit condition. */
  blocking: z.boolean(),
  /** Grounded findings, worst severity first. */
  findings: z.array(Finding),
  /**
   * Enrichment that was unavailable (repo not given, not imported, not indexed).
   * Never an error — the review ran, with a smaller prompt.
   */
  degraded: z.array(z.string()),
});
export type LocalReviewResult = z.infer<typeof LocalReviewResult>;
