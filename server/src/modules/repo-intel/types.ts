/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

/**
 * Identity of a declared symbol: a name is only unique WITHIN a file. Every
 * per-symbol map in BlastResult is keyed with this.
 */
export function symbolKey(file: string, name: string): string {
  return `${file}\u0000${name}`;
}

export type DegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`). Adopted by blast/service.ts in
// T2; in T1 the facade returns a degraded best-effort over container.codeIndex.
// ---------------------------------------------------------------------------

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
  /**
   * `added` when the symbol exists at the PR head but not at the indexed
   * revision; `modified` when it pre-existed and the diff merely touches it.
   *
   * A refactor legitimately touches dozens of symbols, so a flat "changed
   * symbols" count is dominated by call sites that only shifted a line. The
   * distinction is what lets a reader find the handful of things the PR is
   * actually ABOUT. Always `modified` without a head overlay — there is
   * nothing to compare against.
   */
  change: 'added' | 'modified';
}

export interface BlastCallerRow {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  /**
   * The file that changed symbol is declared in. `viaSymbol` alone does NOT
   * identify it — `getById` / `list` / `remove` are each declared in several
   * files in a typical repo, and keying on the bare name makes every same-named
   * symbol report every other one's callers.
   */
  viaFile: string;
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: number;
  /** file_rank.rank of the caller file (0 in the degraded/ripgrep path). */
  rank: number;
}

/** A 1-based, inclusive line span. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * Identify the PR so the facade can look at its code, not just the indexed
 * default branch. Without this the map can only ever describe pre-existing
 * symbols: everything the PR ADDS is invisible, which is exactly the code the
 * reviewer came to look at.
 */
export interface BlastHead {
  /** PR number — used to fetch `pull/<n>/head` into the clone. */
  prNumber: number;
  /** Head commit; every head-side line number below refers to it. */
  sha: string;
  /** Per-file line spans the diff touches, on the HEAD side of the patch. */
  touchedLines?: Record<string, LineRange[]>;
}

export interface BlastOptions {
  /**
   * Per-file line spans the diff actually touches, measured against the BASE
   * side of the patch. When given, only symbols overlapping one of these spans
   * count as "changed".
   *
   * Without it, "symbols declared in a changed file" means EVERY symbol the
   * index knows in that file — a one-line edit to a 40-symbol repository file
   * reports all 40 as changed, which is both wrong and useless. Line numbers
   * come from the index, so this filter is only as aligned as the indexed
   * revision is to the diff's base.
   */
  touchedLines?: Record<string, LineRange[]>;
  /** When set, overlay the PR's own code on top of the persistent index. */
  head?: BlastHead;
}

export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  /**
   * Capped at MAX_CALLERS_PER_SYMBOL **per `viaSymbol`** (not globally) and
   * sorted by `rank` DESC within each symbol. Capping the flat list instead
   * would silently drop whole symbols off the end of a multi-symbol diff.
   */
  callers: BlastCallerRow[];
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: string[];
  /**
   * Caller count per changed symbol BEFORE the cap, so a consumer can say
   * "20 of 63" rather than presenting a truncated list as the whole story.
   * Keyed by `symbolKey(file, name)` — see BlastCallerRow.viaFile for why the
   * bare name is not a key.
   */
  callerTotals: Record<string, number>;
  /**
   * Endpoints/crons attributed to the changed symbol that reaches them, keyed
   * by `symbolKey(file, name)`. Populated on the persistent path by walking the reverse
   * import graph BFS_DEPTH hops out from the declaring file; absent on the
   * degraded path, where only `impactedEndpoints` is available.
   */
  endpointsBySymbol?: Record<string, string[]>;
  cronsBySymbol?: Record<string, string[]>;
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: DegradedReason;
  /**
   * True when the downstream walk hit MAX_BLAST_FRONTIER_FILES and stopped
   * early — the endpoint list is then a subset, not the full picture.
   */
  frontierClipped?: boolean;
  /**
   * True when the PR's own code was parsed and merged in, so symbols the PR
   * ADDS are represented. False/absent means the answer describes only the
   * indexed revision — the consumer must say so.
   */
  headOverlay?: boolean;
  /** Why the overlay could not run, when one was requested but didn't happen. */
  headOverlayReason?: string;
}

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(
    repoId: string,
    changedFiles: string[],
    opts?: BlastOptions,
  ): Promise<BlastResult>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
}
