import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, stripIgnoredFiles } from './diff.js';

/**
 * Sanity test for the self-authored unified-diff parser (agent-runner cannot
 * import the server's `git/diff-parser.ts` — outside owned paths and would
 * break the ncc bundle's self-containment). Must produce the exact
 * `UnifiedDiff`/`DiffHunk` shape the citation-grounding gate needs: per-file
 * hunks with the set of new-side line numbers they cover.
 */
export const FIXTURE_DIFF_RAW = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -9,3 +9,4 @@
 host: 'localhost',
+apiKey: 'sk_live_abcdef123456',
 port: 3000,
 timeout: 30,
`;

describe('parseUnifiedDiff', () => {
  it('parses a single-file, single-hunk diff into files + hunks + new-side line numbers', () => {
    const diff = parseUnifiedDiff(FIXTURE_DIFF_RAW);

    expect(diff.raw).toBe(FIXTURE_DIFF_RAW);
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0]!;
    expect(file.path).toBe('src/config.ts');
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(0);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0]!;
    expect(hunk.oldStart).toBe(9);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(9);
    expect(hunk.newLines).toBe(4);
    // context(9), added(10), context(11), context(12)
    expect(hunk.newLineNumbers).toEqual([9, 10, 11, 12]);
  });

  it('a line NOT covered by any hunk (e.g. 999) is absent from new-side line numbers', () => {
    const diff = parseUnifiedDiff(FIXTURE_DIFF_RAW);
    const covered = new Set(diff.files[0]!.hunks.flatMap((h) => h.newLineNumbers));
    expect(covered.has(999)).toBe(false);
  });

  it('handles multiple files', () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 line one
+line two
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -5,2 +5,2 @@
-old line
+new line
 unchanged
`;
    const diff = parseUnifiedDiff(raw);
    expect(diff.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(diff.files[1]!.deletions).toBe(1);
    expect(diff.files[1]!.additions).toBe(1);
  });

  it('a deleted "-- comment"-style line is still counted as a deletion, not silently dropped', () => {
    // Diff line becomes `--- old debug comment` (marker + content), which
    // used to match the unconditional `startsWith('--- ')` file-header check
    // and get `continue`d away entirely — undercounting deletions.
    const raw = `diff --git a/query.sql b/query.sql
--- a/query.sql
+++ b/query.sql
@@ -1,2 +1,1 @@
--- old debug comment
 SELECT 1;
`;
    const diff = parseUnifiedDiff(raw);
    const file = diff.files[0]!;
    expect(file.path).toBe('query.sql');
    expect(file.deletions).toBe(1);
    expect(file.additions).toBe(0);
    // Only the surviving context line (SELECT 1;) is present in the new file.
    expect(file.hunks[0]!.newLineNumbers).toEqual([1]);
  });

  it('a deleted "--comment"-style line (no space) is not miscounted as a surviving context line', () => {
    // Diff line becomes `---nocomment` — no space after the marker+content,
    // so it does NOT match `startsWith('--- ')` and used to fall through to
    // the "context line" branch instead: wrongly added to `newLineNumbers`
    // (a line the citation-grounding gate would then accept a finding
    // against) even though the line was deleted and doesn't exist any more.
    const raw = `diff --git a/query.sql b/query.sql
--- a/query.sql
+++ b/query.sql
@@ -1,2 +1,1 @@
---nocomment
 SELECT 1;
`;
    const diff = parseUnifiedDiff(raw);
    const file = diff.files[0]!;
    expect(file.deletions).toBe(1);
    // The deleted line must NOT appear in the new file's covered line numbers.
    expect(file.hunks[0]!.newLineNumbers).toEqual([1]);
  });

  it('an added line whose content itself starts with "++" is still counted as an addition', () => {
    // Content `++counter;` makes the diff line `+++counter;` — three literal
    // `+` characters with no following space, which used to fail the old
    // `!line.startsWith('+++')` guard and get miscounted as a context line.
    const raw = `diff --git a/counter.c b/counter.c
--- a/counter.c
+++ b/counter.c
@@ -1,1 +1,2 @@
 int x = 0;
++counter;
`;
    const diff = parseUnifiedDiff(raw);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe('counter.c');
    expect(diff.files[0]!.additions).toBe(1);
  });
});

describe('stripIgnoredFiles', () => {
  const raw = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,1 +1,2 @@
 keep me
+real change
diff --git a/.devdigest/runner/index.js b/.devdigest/runner/index.js
--- a/.devdigest/runner/index.js
+++ b/.devdigest/runner/index.js
@@ -1,1 +1,1 @@
-old bundle
+new bundle
diff --git a/.github/workflows/devdigest-review.yml b/.github/workflows/devdigest-review.yml
--- a/.github/workflows/devdigest-review.yml
+++ b/.github/workflows/devdigest-review.yml
@@ -1,1 +1,2 @@
 name: DevDigest Review
+on: pull_request
`;

  it('drops the .devdigest/ runner bundle (the source of the GitHub 422)', () => {
    const files = parseUnifiedDiff(stripIgnoredFiles(raw)).files.map((f) => f.path);
    expect(files).not.toContain('.devdigest/runner/index.js');
  });

  it('drops the generated .github/workflows/ file', () => {
    const files = parseUnifiedDiff(stripIgnoredFiles(raw)).files.map((f) => f.path);
    expect(files).not.toContain('.github/workflows/devdigest-review.yml');
  });

  it('keeps the target repo files untouched', () => {
    const diff = parseUnifiedDiff(stripIgnoredFiles(raw));
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(diff.files[0]!.additions).toBe(1);
    // the kept section's content survives verbatim
    expect(diff.raw).toContain('+real change');
    expect(diff.raw).not.toContain('new bundle');
  });

  it('is a no-op when nothing is ignored', () => {
    expect(stripIgnoredFiles(FIXTURE_DIFF_RAW)).toBe(FIXTURE_DIFF_RAW);
  });

  it('does NOT drop a real file whose path happens to contain the literal " b/" substring', () => {
    // A directory named `weird b` makes the `diff --git a/<path> b/<path>`
    // header read `diff --git a/weird b/.devdigest/evil.ts b/weird b/.devdigest/evil.ts`.
    // Deciding "ignored?" from that header via a ` b/(.*)$` regex captures a
    // SUFFIX of the OLD-side path starting at its first " b/" — here
    // `.devdigest/evil.ts b/weird b/.devdigest/evil.ts` — which spuriously
    // starts with `.devdigest/` even though the real file (`weird
    // b/.devdigest/evil.ts`) does not. That used to make this file's entire
    // diff section vanish before the LLM ever saw it: a PR-author-controlled
    // review bypass. The fix decides from the unambiguous `+++ b/<path>` line.
    const raw = `diff --git a/weird b/.devdigest/evil.ts b/weird b/.devdigest/evil.ts
--- a/weird b/.devdigest/evil.ts
+++ b/weird b/.devdigest/evil.ts
@@ -1,1 +1,2 @@
 existing line
+malicious change
`;
    const stripped = stripIgnoredFiles(raw);
    expect(stripped).toContain('+malicious change');
    const diff = parseUnifiedDiff(stripped);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe('weird b/.devdigest/evil.ts');
  });
});
