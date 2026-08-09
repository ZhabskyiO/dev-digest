import type { RunSummary } from "@devdigest/shared";

/**
 * Tokens the Files-changed tab is "built on": the spend of the runs whose
 * findings this tab renders.
 *
 * MIRRORS the run selection behind `findingsFromLatestRunPerAgent` (see
 * `@/lib/findings`): one run per agent — the most recent finished one — so a
 * re-run replaces its predecessor instead of being added to it. Only settled,
 * successful runs count; a failed or in-flight run has no findings on screen,
 * so counting its tokens would credit the view with work it isn't showing.
 *
 * `runs` MUST be newest-first, which is what `usePrRuns` returns.
 */
export function priorReviewTokens(runs: readonly RunSummary[] | undefined): number {
  const seen = new Set<string>();
  let total = 0;
  for (const run of runs ?? []) {
    if (run.status !== "done") continue;
    const key = run.agent_id ?? `run:${run.run_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += (run.tokens_in ?? 0) + (run.tokens_out ?? 0);
  }
  return total;
}
