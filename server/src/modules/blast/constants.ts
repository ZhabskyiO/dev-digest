/** Blast module tunables. Index-side limits live in repo-intel/constants.ts. */

/**
 * How many prior PRs touching the same files to return. This is context ("this
 * area has been churned recently"), not a changelog — a long list would push
 * the actual impact map off the card.
 */
export const MAX_PRIOR_PRS = 5;
