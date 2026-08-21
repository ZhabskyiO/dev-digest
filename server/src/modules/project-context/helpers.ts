/**
 * project-context — pure helpers (T9). No I/O, no DB, no git, no tokenizer:
 * every function here is a plain data transform so it can be unit-tested
 * without a fixture clone or a database.
 *
 * `planBudget` used to live here too; it moved to `../_shared/context-budget.js`
 * because it has a genuine second consumer outside this module
 * (`modules/reviews/prompt-context.ts`) — see that file's header for the
 * rationale. Import it from there directly; it is not re-exported here.
 */
import type { ProjectContextOutcome } from '@devdigest/shared';

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
