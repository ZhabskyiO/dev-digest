/**
 * repo-intel constants. Phase-tagged: [T1] used now; [T2]/[T3]
 * exported early so the pipeline lands against a single source of truth.
 */

// --- Job kinds (registered on JobRunner; enqueued from repos/service.ts) ----
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
/** Manual "re-analyze": fetch latest from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';

// --- Walk / parse scope -----------------------------------------------------
/** [T1] Files we parse (diff-scoped in T1; whole walk in T2). */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** [T1] Directories never walked. `.gitignore` is layered on top in T2 walk. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

// --- Read-time limits -------------------------------------------------------
/** [T1] Caller fan-out cap per changed symbol (ORDER BY rank DESC LIMIT N). */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * Ceiling on the downstream-file frontier the blast walk may visit per repo.
 * A hub file (a barrel, a shared util) is imported by hundreds of modules, and
 * two hops out from one of those is most of the repo — without this cap a
 * single PR touching `index.ts` turns one request into a full-graph scan.
 * When the walk clips, `BlastResult.frontierClipped` says so instead of
 * pretending the shorter endpoint list is complete.
 */
export const MAX_BLAST_FRONTIER_FILES = 300;

/**
 * [T1] Bumped whenever the AST extractor or symbol schema changes. A mismatch
 * with `repo_index_state.indexer_version` forces a full reindex.
 *
 * v2 (T3): graph + decl_file resolution + file_rank + repo-map landed, so every
 * T2 `partial` index must be rebuilt to gain the rank-driven data.
 *
 * v3 (blast): `file_facts` no longer records endpoints/crons found in TEST
 * files, and `extractCrons` now recognises a cron expression by its own
 * grammar rather than only next to a `cron`/`schedule` keyword. Both change
 * what a given file yields, so every v2 index carries stale facts — a test
 * suite's `api.get('/articles?limit=1000')` sitting in the endpoint list, and
 * a hoisted `CRON_SCHEDULES` table missing from it — until it is rebuilt.
 *
 * v4 (blast): `extractEndpoints` matches the whole source instead of one line
 * at a time, so a route whose path sits on the line after the verb — i.e. any
 * route with a schema, which in practice is all of them — is finally seen.
 * Every earlier index recorded almost no real endpoints.
 */
export const INDEXER_VERSION = 4;

// --- [T2] Full-index limits (documented now, enforced in the pipeline) ------
export const MAX_INDEXED_FILES = 5000;
export const MAX_FILE_SIZE = 400 * 1024; // 400 KB
export const MAX_PARSE_MS_PER_FILE = 2000;
/** Soft self-watch budget (< JobRunner hard 120s) → finish as `partial`. */
export const INDEX_SOFT_BUDGET_MS = 110_000;

// --- [T3] Graph / hotness / repo-map ---------------------------------------
export const BFS_DEPTH = 2;
export const HOTNESS_WINDOW_DAYS = 180;
export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;
/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
