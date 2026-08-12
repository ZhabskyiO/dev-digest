/**
 * Pure mapping from the repo-intel facade's `BlastResult` to the wire DTO.
 *
 * Nothing here calls a model, the DB, or the filesystem — every value is a
 * rearrangement of what the index already returned. That is the whole point of
 * the feature: a reviewer can re-derive this by hand from the same index.
 */
import type { BlastEndpoint, BlastRadiusResult, BlastStatus, BlastSymbol } from '@devdigest/shared';
import type { BlastResult, IndexState, LineRange } from '../repo-intel/types.js';
import { symbolKey } from '../repo-intel/types.js';

/**
 * Line spans a unified-diff patch touches, on its BASE side.
 *
 * Base side, not head: every line number in the index was measured against the
 * indexed revision, so the only ranges that can be compared to it are the `-`
 * side of the hunk headers (`@@ -start,count +start,count @@`). A hunk with no
 * count (`@@ -12 +12 @@`) is one line.
 *
 * A pure add (count 0) still marks its insertion point so a symbol that gained
 * a body line counts as touched.
 */
export function changedLineRanges(patch: string | null): LineRange[] {
  if (!patch) return [];
  const ranges: LineRange[] = [];
  const header = /^@@ -(\d+)(?:,(\d+))? \+/gm;
  let m: RegExpExecArray | null;
  while ((m = header.exec(patch)) !== null) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    ranges.push({ start, end: count === 0 ? start : start + count - 1 });
  }
  return ranges;
}

/**
 * Split the index's flat `"METHOD /path"` fact into its parts.
 *
 * `extractEndpoints` emits exactly one space between the verb and the path, but
 * a path can't contain a space, so splitting on the FIRST space is safe even if
 * the format ever loosens. Anything unparseable is kept whole as the path with
 * an empty method rather than dropped — an endpoint we can't split is still an
 * endpoint the reviewer should see.
 */
export function parseEndpoint(fact: string, file: string): BlastEndpoint {
  const at = fact.indexOf(' ');
  if (at === -1) return { method: '', path: fact, file };
  return { method: fact.slice(0, at), path: fact.slice(at + 1), file };
}

/**
 * Which changed symbol reaches an endpoint tells you *where to look*; which
 * file registers it tells you *what to open*. `factsByFile` is the only place
 * the second is recorded, so resolve it by reverse lookup and fall back to an
 * empty string when the facade ran on the degraded path (no factsByFile).
 */
function fileForEndpoint(
  fact: string,
  factsByFile: BlastResult['factsByFile'],
): string {
  if (!factsByFile) return '';
  for (const [file, facts] of Object.entries(factsByFile)) {
    if (facts.endpoints.includes(fact)) return file;
  }
  return '';
}

/**
 * Map the index's status onto what the client can act on.
 *
 * A `partial` index is a WORKING index — what it reports is true, it just may
 * not have seen everything — so it is not folded into `degraded`. Collapsing
 * the two would make "we indexed 95% of the repo" indistinguishable from "we
 * have no index at all".
 */
export function buildStatus(
  indexState: IndexState,
  blast: BlastResult,
  /** The PR's head sha, when known — see the staleness branch below. */
  headSha?: string | null,
): { status: BlastStatus; reason: string | null } {
  if (blast.degraded || indexState.degraded || indexState.status === 'degraded') {
    return {
      status: 'degraded',
      reason: degradedReason(indexState, blast),
    };
  }
  // The index is built from the repo's DEFAULT BRANCH, never from a PR branch.
  // So anything this PR *adds* — new functions, new routes, a new cron — does
  // not exist in the index and cannot appear below. Reporting `ready` here is
  // the single most misleading thing this endpoint could do: the map would look
  // complete while missing exactly the code under review.
  const stale = headSha != null && headSha !== '' && headSha !== indexState.lastIndexedSha;
  if (indexState.status === 'partial' || blast.frontierClipped || stale) {
    const parts: string[] = [];
    if (stale) {
      parts.push(
        `the index is built from ${short(indexState.lastIndexedSha)}, but this PR is at ${short(headSha)} — symbols this PR ADDS are not indexed yet and cannot appear here`,
      );
    }
    if (indexState.status === 'partial') {
      parts.push(
        indexState.filesSkipped > 0
          ? `the index is partial — ${indexState.filesSkipped} file(s) were skipped`
          : 'the index is partial',
      );
    }
    if (blast.frontierClipped) {
      parts.push('the downstream walk hit its file budget and stopped early');
    }
    return { status: 'partial', reason: `${parts.join('; ')}. Callers may be missing.` };
  }
  return { status: 'ready', reason: null };
}

/** Short sha for a human-readable reason string. */
function short(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : 'an unknown revision';
}

function degradedReason(indexState: IndexState, blast: BlastResult): string {
  const code = indexState.degradedReason ?? blast.reason;
  switch (code) {
    case 'flag_off':
      return 'Repo intelligence is disabled (REPO_INTEL_ENABLED=false), so nothing is indexed.';
    case 'index_failed':
      return 'The last index run failed. Re-run it from the repo page (Re-analyze).';
    case 'index_partial':
      return 'The index is incomplete. Re-run it from the repo page (Re-analyze).';
    case 'repo_too_large':
      return 'The repo is past the indexing size limit, so only a best-effort scan ran.';
    default:
      return 'This repo has not been indexed yet, so results come from a best-effort text scan and may be incomplete.';
  }
}

/**
 * A deterministic one-liner, NOT a model summary — same index state in, same
 * sentence out. The MCP tool documents a `summary` field, and a reviewer
 * skimming the tool output should get the shape of the impact without parsing
 * the arrays.
 */
export function buildSummary(
  totals: BlastRadiusResult['totals'],
  status: BlastStatus,
): string {
  if (totals.symbols === 0) {
    return status === 'degraded'
      ? 'No symbols could be resolved in the changed files — the repo is not indexed.'
      : 'No indexed symbols are declared in the changed files.';
  }
  const parts = [
    `${totals.symbols} changed symbol${totals.symbols === 1 ? '' : 's'}`,
    `${totals.callers} caller${totals.callers === 1 ? '' : 's'}`,
  ];
  if (totals.endpoints > 0) {
    parts.push(`${totals.endpoints} endpoint${totals.endpoints === 1 ? '' : 's'}`);
  }
  if (totals.crons > 0) {
    parts.push(`${totals.crons} cron/job${totals.crons === 1 ? '' : 's'}`);
  }
  const tail = status === 'ready' ? '' : ' (incomplete — see reason)';
  return `${parts.join(' · ')}${tail}`;
}

/** Shape the facade result + PR context into the response body. */
export function toBlastDto(input: {
  pullId: string;
  headSha: string | null;
  changedFiles: string[];
  blast: BlastResult;
  indexState: IndexState;
  priorPrs: BlastRadiusResult['prior_prs'];
}): BlastRadiusResult {
  const { pullId, headSha, changedFiles, blast, indexState, priorPrs } = input;
  const { status, reason } = buildStatus(indexState, blast, headSha);

  // Callers are already capped per symbol and rank-sorted by the facade; this
  // only regroups them under the symbol they reach.
  // Keyed by (declaring file, name): a bare name is not unique across files.
  const callersBySymbol = new Map<string, BlastSymbol['callers']>();
  for (const c of blast.callers) {
    const k = symbolKey(c.viaFile, c.viaSymbol);
    const arr = callersBySymbol.get(k);
    const ref = { file: c.file, line: c.line, symbol: c.symbol, rank: c.rank };
    if (arr) arr.push(ref);
    else callersBySymbol.set(k, [ref]);
  }

  const symbols: BlastSymbol[] = blast.changedSymbols.map((s) => {
    const k = symbolKey(s.file, s.name);
    const endpoints = (blast.endpointsBySymbol?.[k] ?? []).map((fact) =>
      parseEndpoint(fact, fileForEndpoint(fact, blast.factsByFile)),
    );
    return {
      name: s.name,
      kind: s.kind,
      file: s.file,
      callers: callersBySymbol.get(k) ?? [],
      caller_count: blast.callerTotals[k] ?? 0,
      endpoints,
      crons: blast.cronsBySymbol?.[k] ?? [],
    };
  });

  // Symbols with the widest reach first — that is the order a reviewer wants to
  // read them in, and it makes the collapsed rows below the fold the cheap ones.
  symbols.sort((a, b) => b.caller_count - a.caller_count || a.name.localeCompare(b.name));

  // Union over the symbols we actually report — NOT `blast.impactedEndpoints`,
  // which is the facade's union over every symbol it considered. Those diverge
  // once symbols are filtered, and a total that outruns the visible rows reads
  // as a bug to anyone checking the card against the tree.
  const seenEp = new Set<string>();
  const endpoints: BlastEndpoint[] = [];
  for (const sym of symbols) {
    for (const e of sym.endpoints) {
      const k = `${e.method} ${e.path}`;
      if (seenEp.has(k)) continue;
      seenEp.add(k);
      endpoints.push(e);
    }
  }
  const crons = [...new Set(symbols.flatMap((s) => s.crons))];

  const totals = {
    symbols: symbols.length,
    callers: symbols.reduce((n, s) => n + s.caller_count, 0),
    endpoints: endpoints.length,
    crons: crons.length,
  };

  return {
    pull_id: pullId,
    status,
    reason,
    degraded: status === 'degraded',
    indexed_sha: indexState.lastIndexedSha || null,
    changed_files: changedFiles,
    symbols,
    endpoints,
    crons,
    totals,
    prior_prs: priorPrs,
    summary: buildSummary(totals, status),
  };
}
