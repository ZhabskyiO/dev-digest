/**
 * Smart Diff — deterministic, reviewer-first ordering of a PR's changed files.
 *
 * PURE. No I/O, no clock, no DB, and above all NO LLM CALL: this module turns
 * data the server already imported (PR files) plus findings already persisted
 * by the last review into the `SmartDiff` contract. Rendering the Files-changed
 * tab must never cost a token — that is an acceptance criterion, and keeping
 * this file free of the container is how it stays true.
 *
 * Every threshold and pattern comes from `./constants.ts`.
 */

import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  CLASSIFY_RULES,
  MAX_PROPOSED_SPLITS,
  ROLE_ORDER,
  SPLIT_CONTAINER_DIRS,
  SPLIT_GENERATED_BUCKET,
  SPLIT_MIN_FILES,
  SPLIT_TOO_BIG_LINES,
} from './constants.js';

/** The subset of a PR file this module needs — deliberately not `PrFile`. */
export interface ClassifiableFile {
  path: string;
  additions: number;
  deletions: number;
}

/** The subset of a finding this module needs: which file, which line. */
export interface FindingAnchor {
  file: string;
  start_line: number;
}

/**
 * Which bucket a path belongs to. First matching rule wins; no match ⇒ `core`.
 *
 * Exported for its own tests — the lockfile guarantee is asserted directly
 * against this function rather than through the whole pipeline.
 */
export function classifyPath(path: string): SmartDiffRole {
  for (const rule of CLASSIFY_RULES) {
    if (rule.pattern.test(path)) return rule.role;
  }
  return 'core';
}

/** Total changed lines — the "size" every ordering and threshold uses. */
function churn(file: ClassifiableFile): number {
  return file.additions + file.deletions;
}

/**
 * Findings-first, then size, then path.
 *
 * Path is the final tiebreaker rather than input order so the response is
 * stable across requests: `getPrFiles` has no ORDER BY, so Postgres may hand
 * back the same rows in a different order and an unstable sort would reshuffle
 * the reviewer's list between refreshes.
 */
function byRisk(a: SmartDiffFile, b: SmartDiffFile): number {
  if (a.finding_lines.length !== b.finding_lines.length) {
    return b.finding_lines.length - a.finding_lines.length;
  }
  const churnA = a.additions + a.deletions;
  const churnB = b.additions + b.deletions;
  if (churnA !== churnB) return churnB - churnA;
  return a.path.localeCompare(b.path);
}

/**
 * The split bucket for a path: its top-level directory, or the first two
 * segments when the top level is a container dir (`src/api`, not `src`).
 * A file at the repo root buckets under its own name.
 */
function splitBucketFor(path: string): string {
  const segments = path.split('/');
  const first = segments[0] ?? path;
  if (segments.length < 2) return first;
  if (SPLIT_CONTAINER_DIRS.includes(first) && segments.length > 2) {
    return `${first}/${segments[1]}`;
  }
  return first;
}

/**
 * Lines in a file that carry a finding, deduplicated and ascending.
 *
 * Anchors on `start_line` only: a finding spanning 40→60 marks line 40, the
 * line the reviewer is scrolled to, not all 21 lines in between — which would
 * make the per-file finding count meaningless.
 */
function findingLinesFor(path: string, anchors: readonly FindingAnchor[]): number[] {
  const lines = new Set<number>();
  for (const a of anchors) {
    if (a.file === path) lines.add(a.start_line);
  }
  return [...lines].sort((x, y) => x - y);
}

/**
 * Build the `SmartDiff` response.
 *
 * `anchors` should be the findings of the LATEST review only — mixing runs
 * would double-count a finding two agents both reported. Pass `[]` for a PR
 * that has never been reviewed; grouping and ordering still work, every
 * `finding_lines` is just empty.
 *
 * Groups are emitted in `ROLE_ORDER` and a role with no files is omitted, so
 * the client never renders an empty "Wiring" header.
 */
export function buildSmartDiff(
  files: readonly ClassifiableFile[],
  anchors: readonly FindingAnchor[],
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();

  for (const file of files) {
    const role = classifyPath(file.path);
    const entry: SmartDiffFile = {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLinesFor(file.path, anchors),
      // Always null: a pseudocode summary is a model-written sentence, and
      // Smart Diff is contractually LLM-free. The field stays in the contract
      // for a future summarizer to populate; the client renders nothing when
      // it is null rather than showing an empty "What this does" row.
      pseudocode_summary: null,
    };
    const bucket = byRole.get(role);
    if (bucket) bucket.push(entry);
    else byRole.set(role, [entry]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const bucket = byRole.get(role);
    if (!bucket || bucket.length === 0) continue;
    groups.push({ role, files: bucket.sort(byRisk) });
  }

  return { groups, split_suggestion: buildSplitSuggestion(files) };
}

/**
 * Whether the PR is large enough to suggest splitting, and along which seams.
 *
 * Both conditions must hold: a 900-line change across two files is one
 * cohesive edit, not three PRs waiting to happen.
 */
function buildSplitSuggestion(files: readonly ClassifiableFile[]): SmartDiff['split_suggestion'] {
  const totalLines = files.reduce((sum, f) => sum + churn(f), 0);
  const tooBig = totalLines > SPLIT_TOO_BIG_LINES && files.length >= SPLIT_MIN_FILES;

  if (!tooBig) return { too_big: false, total_lines: totalLines, proposed_splits: [] };

  // Boilerplate collapses into one bucket regardless of where it lives —
  // "pull the lockfile and the snapshots out" is the single most useful split,
  // and scattering them across feature buckets would hide it.
  const buckets = new Map<string, string[]>();
  for (const file of files) {
    const name =
      classifyPath(file.path) === 'boilerplate'
        ? SPLIT_GENERATED_BUCKET
        : splitBucketFor(file.path);
    const bucket = buckets.get(name);
    if (bucket) bucket.push(file.path);
    else buckets.set(name, [file.path]);
  }

  // A single bucket is not a split — there is no seam to cut along.
  if (buckets.size < 2) {
    return { too_big: true, total_lines: totalLines, proposed_splits: [] };
  }

  const proposed = [...buckets.entries()]
    .map(([name, paths]) => ({ name, files: paths.sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name))
    .slice(0, MAX_PROPOSED_SPLITS);

  return { too_big: true, total_lines: totalLines, proposed_splits: proposed };
}
