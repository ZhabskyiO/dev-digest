/**
 * Project-context token-budget planning (AC-23, AC-40). Pure — no I/O, no
 * DB — so it is unit-testable without a fixture clone or a database.
 *
 * Moved out of `modules/project-context/helpers.ts` into `_shared` (an
 * architecture-review finding) so `modules/reviews/prompt-context.ts` can
 * reuse it without a module→module internal import — mirrors the precedent
 * `_shared/net-guards.ts` and `_shared/context-ref.ts` already document.
 * `planBudget` is the one helper in that file with a genuine second
 * consumer outside `project-context/`; `mergeEffectiveSet`,
 * `outcomePrecedence`, and `resolveOutcome` stay in
 * `project-context/helpers.ts` — they are used only within that module.
 */

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
 * "what would be dropped" preview in the effective-context UI
 * (`ProjectContextService.effectiveContext`), and AC-23's actual run-time
 * drop (`resolveProjectContext`). Both call this with the SAME input — the
 * agent's full effective document set, in persisted order, using each
 * document's persisted token estimate — so the `dropped` list this function
 * returns is guaranteed identical between the two. `resolveProjectContext`
 * determines `missing`/`wrong_repo` as a SEPARATE, later step layered on top
 * of this function's verdict (never by filtering candidates before calling
 * it) — filtering first was the bug this comment used to describe as merely
 * aspirational; see `EffectiveProjectContext.dropped_paths`'s own contract
 * doc for the same guarantee stated from the caller's side.
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
