/**
 * project-context reader constants.
 *
 * Directory segments the document scan never enters, at any depth. `clones`
 * is the load-bearing one: an imported repo may itself be a checkout of
 * DevDigest, whose own `server/clones/` holds a full copy of every other
 * imported repo, so omitting this exclusion multiplies the document list by
 * the number of imported repos and can inject an unrelated project's specs
 * into a review. `node_modules`/`.git`/`dist`/`.next` are noise-reduction on
 * top of that.
 */
export const EXCLUDED_SEGMENTS = ['clones', 'node_modules', '.git', 'dist', '.next'] as const;
