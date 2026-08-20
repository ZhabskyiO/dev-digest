/**
 * project-context — pure helpers (T9). No I/O, no DB, no git, no tokenizer:
 * every function here is a plain data transform so it can be unit-tested
 * without a fixture clone or a database.
 */
import type { ProjectContextOutcome } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Budget planning (AC-23, AC-40)
// ---------------------------------------------------------------------------

export interface PlanBudgetResult<T> {
  /** Documents that fit, in the same order they were given. */
  injected: T[];
  /** Everything from the first document that didn't fit onward, in order. */
  dropped: T[];
}

/**
 * Plans which documents fit a token budget, in order — "stop at first
 * overflow": documents are injected while the running total stays within
 * `budgetTokens`; the FIRST document that would push the total over the
 * budget, and every document after it, is dropped, even if a later document
 * alone would have fit. This is deliberately not a best-fit/knapsack packing
 * — prompt order matters more than squeezing in a smaller later document
 * out of order (AC-14 already defines order as prompt order).
 *
 * Shared by two callers that must agree on the exact same tail: AC-40's
 * "what would be dropped" preview in the effective-context UI, and AC-23's
 * actual run-time drop. Both must compute the identical `dropped` list for
 * the same input, or the UI's warning would lie about what a run actually
 * does.
 */
export function planBudget<T extends { tokens: number }>(
  docs: readonly T[],
  budgetTokens: number,
): PlanBudgetResult<T> {
  const injected: T[] = [];
  const dropped: T[] = [];
  let used = 0;
  let overBudget = false;

  for (const doc of docs) {
    if (!overBudget && used + doc.tokens <= budgetTokens) {
      injected.push(doc);
      used += doc.tokens;
    } else {
      overBudget = true;
      dropped.push(doc);
    }
  }

  return { injected, dropped };
}

// ---------------------------------------------------------------------------
// Effective context merge (AC-16)
// ---------------------------------------------------------------------------

/**
 * Computes an agent's effective context set: its own attachments followed by
 * the attachments of its (already filtered to linked-AND-enabled, in link
 * order) skills, de-duplicated by `(repo_id, path)`, keeping the FIRST
 * occurrence's position — which is always the agent's own copy when both
 * exist, because `ownAttachments` is concatenated first.
 *
 * The two-gate skill filter (linked AND globally enabled) is NOT this
 * function's job — it must already be applied to `skillAttachments` by the
 * caller, mirroring `modules/reviews/prompt-context.ts::resolveAgentSkills`.
 * This function only merges and de-dupes two already-ordered lists.
 */
export function mergeEffectiveSet<T extends { repo_id: string; path: string }>(
  ownAttachments: readonly T[],
  skillAttachments: readonly T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const doc of ownAttachments) {
    const key = mergeKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(doc);
  }
  for (const doc of skillAttachments) {
    const key = mergeKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(doc);
  }

  return merged;
}

function mergeKey(doc: { repo_id: string; path: string }): string {
  return `${doc.repo_id}\x00${doc.path}`;
}

// ---------------------------------------------------------------------------
// Outcome precedence (AC-29, AC-24, AC-44)
// ---------------------------------------------------------------------------

/**
 * The run trace's per-document `outcome` field (AC-29) is a single enum, but
 * two independent facts can hold for the same document at once: AC-24
 * (truncated to the per-document char cap) and AC-44 (injected anyway despite
 * having drifted since attach, i.e. changed-and-unconfirmed). A document can
 * be BOTH truncated and changed-unconfirmed; `outcome` can only name one, so
 * a precedence order picks which, and `ProjectContextTraceItem`'s
 * `truncated?`/`changed?` booleans carry whichever fact loses.
 *
 * Highest to lowest precedence: a document that never reached the model at
 * all (`missing`, `wrong_repo`, `dropped_over_budget`) always outranks one
 * that did (`changed_unconfirmed`, `truncated`, `injected`) — "was it in the
 * prompt at all" is the more important fact to surface first. Among the
 * "reached the model" outcomes, an unconfirmed content change outranks a
 * mere truncation, because a differing body is the more surprising fact for
 * a reviewer checking what the model actually saw.
 */
const OUTCOME_PRECEDENCE: readonly ProjectContextOutcome[] = [
  'missing',
  'wrong_repo',
  'dropped_over_budget',
  'changed_unconfirmed',
  'truncated',
  'injected',
];

/** The full precedence order, highest first. */
export function outcomePrecedence(): readonly ProjectContextOutcome[] {
  return OUTCOME_PRECEDENCE;
}

/**
 * Picks the single highest-precedence outcome among a set of candidate
 * outcomes that simultaneously apply to one document. `injected` is the
 * default for an empty/all-unmatched candidate set — nothing else applied.
 */
export function resolveOutcome(
  candidates: ReadonlySet<ProjectContextOutcome> | readonly ProjectContextOutcome[],
): ProjectContextOutcome {
  const set = candidates instanceof Set ? candidates : new Set(candidates);
  for (const outcome of OUTCOME_PRECEDENCE) {
    if (set.has(outcome)) return outcome;
  }
  return 'injected';
}
