/**
 * Head overlay — parse a pull request's OWN code, diff-scoped.
 *
 * The persistent index is built from the default branch, so a PR's added
 * symbols, its new call sites and its new cron/route registrations do not exist
 * in it. Reading blast radius purely off the index therefore describes the code
 * the PR *touches* while omitting the code it *introduces* — the exact opposite
 * of what a reviewer asked for.
 *
 * This module closes that gap without a schema change: fetch the PR ref into
 * the existing clone, read only the changed files at head, and parse them
 * in-memory. Nothing is persisted — the overlay is derived per request and is
 * valid only for the head sha it was built from.
 *
 * Scope limit worth knowing: because only CHANGED files are parsed, a caller of
 * a newly-added symbol that lives in an untouched file cannot be seen. In
 * practice a PR that adds a symbol also edits whatever starts calling it, so
 * the common case is covered; the uncommon one under-reports rather than
 * inventing an edge.
 */
import type { RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { parseSymbols, parseReferences, langForFile } from '../../adapters/astgrep/index.js';
import { extractEndpoints, extractCrons } from '../../adapters/codeindex/extract.js';
import { isTestFile } from './helpers.js';
import type { BlastHead, LineRange } from './types.js';

export interface HeadSymbol {
  file: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
}

export interface HeadReference {
  fromPath: string;
  toSymbol: string;
  line: number;
}

export interface HeadOverlay {
  /** Symbols declared in the changed files, as they exist at the PR head. */
  symbols: HeadSymbol[];
  /** Cross-file references between changed files, at the PR head. */
  references: HeadReference[];
  /** Endpoints/crons registered by the changed files, at the PR head. */
  facts: Record<string, { endpoints: string[]; crons: string[] }>;
  /** Files actually read (a deleted file, or one absent at head, is skipped). */
  filesRead: string[];
}

/** Does a declaration's span overlap any line the diff touched? */
function overlaps(ranges: LineRange[] | undefined, start: number, end: number): boolean {
  if (!ranges) return true;
  return ranges.some((r) => r.start <= end && start <= r.end);
}

/**
 * Build the overlay, or return `null` with a reason when it cannot run.
 *
 * Never throws: a missing clone, an unfetchable ref or an unreadable file all
 * degrade to "no overlay", and the caller reports that state rather than
 * silently serving an index-only answer as if it were complete.
 */
export async function buildHeadOverlay(
  container: Container,
  ref: RepoRef,
  changedFiles: string[],
  head: BlastHead,
): Promise<{ overlay: HeadOverlay } | { reason: string }> {
  const parseable = changedFiles.filter((f) => langForFile(f) !== null);
  if (parseable.length === 0) return { reason: 'no parseable files in this diff' };

  // The PR ref usually isn't in a clone that only ever tracks the default
  // branch. Fetching is idempotent and cheap; a failure here is normal for a
  // fork PR or an offline box, so it degrades rather than throws.
  try {
    await container.git.fetchPullHead(ref, head.prNumber);
  } catch (err) {
    return {
      reason: `could not fetch pull/${head.prNumber}/head (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const symbols: HeadSymbol[] = [];
  const references: HeadReference[] = [];
  const facts: Record<string, { endpoints: string[]; crons: string[] }> = {};
  const filesRead: string[] = [];

  for (const file of parseable) {
    let source: string;
    try {
      source = await container.git.readFileAt(ref, head.sha, file);
    } catch {
      continue; // deleted by this PR, or otherwise absent at head
    }
    filesRead.push(file);

    const ranges = head.touchedLines?.[file];
    for (const s of parseSymbols(file, source)) {
      // Dual-emitted `Class.method` duplicates the bare form; keep one.
      if (s.name.includes('.')) continue;
      if (!overlaps(ranges, s.line, s.endLine)) continue;
      symbols.push({ file, name: s.name, kind: s.kind, line: s.line, endLine: s.endLine });
    }

    for (const r of parseReferences(file, source)) {
      references.push({ fromPath: file, toSymbol: r.toSymbol, line: r.line });
    }

    // Test files assert against routes, they do not register them — see
    // isTestFile. Crons are read from tests too for the same reason.
    if (!isTestFile(file)) {
      const endpoints = extractEndpoints(source);
      const crons = extractCrons(source);
      if (endpoints.length > 0 || crons.length > 0) facts[file] = { endpoints, crons };
    }
  }

  if (filesRead.length === 0) return { reason: 'no changed file could be read at the PR head' };
  return { overlay: { symbols, references, facts, filesRead } };
}
