import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';

/**
 * Repo-relative path prefixes whose diff sections are dropped BEFORE review.
 * These are DevDigest's own exported artifacts, not the target repo's code:
 *
 *  - `.devdigest/` — the checked-in agent config AND the ncc runner bundle
 *    (`.devdigest/runner/index.js`), a single minified megafile. GitHub rejects
 *    an inline comment on such a file with 422 "diff too large" and — because a
 *    review is all-or-nothing — fails the ENTIRE review. This prefix is the fix
 *    for that 422; it only ever appears in the diff of the export/update PR
 *    itself, but that PR would otherwise never post a passing review.
 *  - `.github/workflows/` — the generated GHA workflow; reviewing our own
 *    generated CI YAML is pure noise.
 *
 * Stripping them from the RAW diff (not just the parsed file list) matters:
 * single-pass review feeds `diff.raw` straight to the model
 * (`reviewer-core/review/run.ts`), so filtering only `files` would still spend
 * tokens on — and let the model cite — the ignored paths.
 */
export const IGNORED_DIFF_PREFIXES = ['.devdigest/', '.github/workflows/'] as const;

function isIgnoredDiffPath(path: string): boolean {
  return IGNORED_DIFF_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Remove whole `diff --git` sections for ignored paths from a raw unified diff,
 * keeping the raw text and the later-parsed file list consistent.
 *
 * Deciding "is this the ignored file's section" from the `diff --git a/<path>
 * b/<path>` header itself is NOT safe: a real path containing the literal
 * substring ` b/` (e.g. a directory named `weird b`) makes the regex capture
 * a *suffix* of the old-side path as if it were the new-side path, which can
 * spoof a completely unrelated file into looking like `.devdigest/...` and
 * get its whole diff section silently dropped from review — a real, PR-author-
 * controlled review bypass. The immediately-following `+++ b/<path>` line has
 * exactly one unambiguous path (same technique `parseUnifiedDiff` already uses
 * for `current.path`), so buffer each file's section and decide on that line.
 */
export function stripIgnoredFiles(raw: string): string {
  const kept: string[] = [];
  let buffer: string[] = [];
  let skipping = false;

  const flush = () => {
    if (!skipping) kept.push(...buffer);
    buffer = [];
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      flush();
      skipping = false; // refined below once the unambiguous `+++` line arrives
    }
    buffer.push(line);
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '').trim();
      skipping = p !== '/dev/null' && isIgnoredDiffPath(p);
    }
  }
  flush();

  return kept.join('\n');
}

/**
 * Minimal unified-diff parser — a self-contained agent-runner copy of the
 * server's `git/diff-parser.ts` (not importable here: it lives outside this
 * package's owned paths and the bundle must stay self-contained, importing
 * nothing from `node_modules/@devdigest/*` or sibling packages at runtime).
 * Produces the exact `UnifiedDiff` shape the citation-grounding gate
 * (`groundFindings`, reviewer-core) needs: per-file hunks + the set of
 * new-side line numbers each hunk covers.
 *
 * Handles standard unified diff output as returned by GitHub's
 * `Accept: application/vnd.github.v3.diff` PR endpoint:
 *   diff --git a/path b/path
 *   --- a/path
 *   +++ b/path
 *   @@ -oldStart,oldLines +newStart,newLines @@
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  const lines = raw.split('\n');
  // A diff string that ends with a trailing newline (the overwhelmingly common
  // case — `git diff`/GitHub's diff endpoint always terminate the last line)
  // produces one extra empty element from `split('\n')`. Without dropping it,
  // that phantom "line" gets counted as a context line, over-extending the
  // last hunk's new-side line coverage by one — which would make the
  // citation-grounding gate too lenient (accepting a finding one line past
  // the real hunk).
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let current: UnifiedDiff['files'][number] | null = null;
  let hunk: DiffHunk | null = null;
  let newLineCursor = 0;
  // True once the current file's first hunk header (`@@ ... @@`) has been
  // seen. Before that, we're still in the `--- a/x` / `+++ b/x` file-header
  // lines; after it, EVERY line is hunk content and must be classified by its
  // marker CHARACTER alone. Gating the header-line checks on this flag (rather
  // than a `startsWith('+++ ')`/`startsWith('--- ')` run unconditionally on
  // every line, as before) matters because hunk content can itself start with
  // those exact sequences — e.g. a deleted SQL/Lua `--comment` line becomes
  // the diff line `---comment`, which used to be misread as context (a line
  // present in the new file) instead of a deletion, letting the citation-
  // grounding gate accept a finding on a line that no longer exists.
  let inHunkBody = false;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      flushFile();
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      inHunkBody = false;
      continue;
    }
    if (!inHunkBody && line.startsWith('+++ ')) {
      if (!current) current = { path: '', additions: 0, deletions: 0, hunks: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (!inHunkBody && line.startsWith('--- ')) continue;
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      inHunkBody = true;
      flushHunk();
      const newStart = Number(hh[3]);
      const newLines = hh[4] ? Number(hh[4]) : 1;
      hunk = {
        file: current?.path ?? '',
        oldStart: Number(hh[1]),
        oldLines: hh[2] ? Number(hh[2]) : 1,
        newStart,
        newLines,
        newLineNumbers: [],
      };
      newLineCursor = newStart;
      continue;
    }
    if (!current || !hunk) continue;
    const marker = line.charAt(0);
    if (marker === '+') {
      current.additions++;
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    } else if (marker === '-') {
      current.deletions++;
      // deletion: no new-side line consumed
    } else {
      // context line: advances new-side cursor and counts as covered
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    }
  }
  flushFile();

  return { raw, files: files.filter((f) => f.path) };
}
