/**
 * Multi-Agent Review (L07) — shared constants.
 *
 * Kept in its own file (no logic) so both `estimates.ts` and any future
 * caller (e.g. the repository query building the per-agent run-history
 * window) can import it without pulling in the aggregation functions.
 */

/**
 * D-3 leaves the run-history window used to compute a pre-run duration/cost
 * estimate to the planner; Rec-3 fixes it at 10 — the last 10 completed runs
 * per agent, workspace-wide. Large enough to smooth one slow/expensive run,
 * small enough that a model or prompt change shows up within a working
 * session.
 */
export const ESTIMATE_RUN_WINDOW = 10;
