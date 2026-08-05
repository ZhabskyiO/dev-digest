/** Constants for the agents module. */

/** Initial config version recorded for a newly-created agent. */
export const INITIAL_AGENT_VERSION = 1;

/** Default agent description when none is supplied on insert. */
export const DEFAULT_AGENT_DESCRIPTION = '';

/**
 * Cap on the run-stats trend/delta window (`GET /agents/:id/stats?days=`).
 * `dailyRunCounts` allocates one bucket per day and `avgCostDelta` scans a
 * second window of equal length — both stay cheap and bounded even if a
 * caller passes an absurd `days` value.
 */
export const MAX_TREND_DAYS = 90;
