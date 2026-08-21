/**
 * PR Brief — per-file summary selection and truncation.
 *
 * PURE. No I/O, no clock, no DB, no LLM call: this module only decides WHICH
 * files are worth asking the model to summarize and how a model's answer gets
 * clamped to a storable size. The actual `llm.completeStructured` call lives
 * in `brief/service.ts` (T12), which calls `selectFilesToSummarize` first and
 * `truncateSummary` on every reply.
 *
 * Classification is never re-implemented here — `classifyPath` (already
 * exported by `../smart-diff/index.js`) is the single source of truth for
 * which paths are boilerplate, including the lockfile rule. Re-deriving a
 * second lockfile/pattern list here would let the two drift.
 */

import { classifyPath } from '../smart-diff/index.js';

/** The subset of a PR file this module needs to rank candidates. */
export interface SummarizableFile {
  path: string;
  additions: number;
  deletions: number;
}

/** What `selectFilesToSummarize` hands back to its caller — no ranking fields. */
export interface SummaryCandidate {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * At most this many files are named in one batched file-summaries call
 * (AC-36). The 21st-ranked file and beyond are simply never asked about, and
 * behave exactly like a file that has no summary.
 */
export const MAX_SUMMARIZED_FILES = 20;

/** Cap for a persisted per-file summary, ellipsis included (AC-40). */
const SUMMARY_MAX_LENGTH = 200;
const SUMMARY_ELLIPSIS = '…';

/** Total changed lines — the churn tiebreaker used to rank candidates. */
function churn(file: SummarizableFile): number {
  return file.additions + file.deletions;
}

/**
 * Which files are worth a model-written summary.
 *
 * Keeps only `core`/`wiring` files (AC-35) — `boilerplate` (lockfiles,
 * generated output, tests, …) never gets a summary request, however large its
 * diff. Candidates are ranked by finding count desc, then churn desc, then
 * path asc (the same stable, input-order-independent tiebreaker `smart-diff`
 * uses, for the same reason: `getPrFiles` has no `ORDER BY`), and capped at
 * `MAX_SUMMARIZED_FILES`.
 *
 * `findingCounts` is looked up by `path`; a file absent from the map is
 * treated as having zero findings — the same default `Map.get` would produce
 * a second time at every call site.
 */
export function selectFilesToSummarize(
  files: readonly SummarizableFile[],
  findingCounts: ReadonlyMap<string, number>,
): SummaryCandidate[] {
  const eligible = files.filter((file) => {
    const role = classifyPath(file.path);
    return role === 'core' || role === 'wiring';
  });

  const ranked = eligible
    .map((file) => ({
      file,
      findingCount: findingCounts.get(file.path) ?? 0,
      churn: churn(file),
    }))
    .sort((a, b) => {
      if (a.findingCount !== b.findingCount) return b.findingCount - a.findingCount;
      if (a.churn !== b.churn) return b.churn - a.churn;
      return a.file.path.localeCompare(b.file.path);
    });

  return ranked.slice(0, MAX_SUMMARIZED_FILES).map(({ file }) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

/**
 * Collapse a model's reply to one line and clamp it to a storable size.
 *
 * Whitespace (including newlines) collapses to single spaces first — a
 * per-file summary is persisted and rendered as one line, never wrapped
 * across multiple. When the collapsed text still exceeds
 * `SUMMARY_MAX_LENGTH`, it is cut so the returned string is EXACTLY that
 * length with `…` as its final character (AC-40) — never discarded, never
 * left over-length.
 */
export function truncateSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= SUMMARY_MAX_LENGTH) return collapsed;
  return collapsed.slice(0, SUMMARY_MAX_LENGTH - SUMMARY_ELLIPSIS.length) + SUMMARY_ELLIPSIS;
}
