/* helpers.ts — a small, pure line-level differ for DriftCompare (AC-38).
   Classic LCS backtrack, no dependency, over an O(n·m) matrix. The bodies
   are NOT capped upstream: `service.ts`'s `drift()` returns `previous` /
   `current` uncapped — only the separate preview endpoint applies the
   `projectContextPreviewChars` cap — and discovery allows files up to
   `PROJECT_CONTEXT_MAX_FILE_BYTES` (1 MiB), tens of thousands of lines.
   So this module enforces its own budget (`DIFF_MAX_LINES`) before ever
   building the matrix, independently of whatever the server sends. */

export type DiffLineType = "context" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  /** True when either side exceeded `DIFF_MAX_LINES` and was truncated
   *  before diffing — the caller MUST surface this, never render a
   *  truncated diff as if it were complete. */
  truncated: boolean;
}

/** Matrix cells are `(min(n, DIFF_MAX_LINES) + 1) * (min(m, DIFF_MAX_LINES) + 1)`
 *  at most — bounds the LCS table to a few million cells regardless of input
 *  size, so a large document truncates instead of freezing or OOM-ing the tab. */
export const DIFF_MAX_LINES = 2000;

/** Line-level diff of `previous` → `current`. Lines equal on both sides are
 *  `context`; a line only in `previous` is `removed`; a line only in
 *  `current` is `added`. Order is preserved as a human reads it top to
 *  bottom — not grouped by type. Each side is capped at `DIFF_MAX_LINES`
 *  lines before diffing; `truncated` is true when either side was cut. */
export function diffLines(previous: string, current: string): DiffResult {
  const aFull = previous.split("\n");
  const bFull = current.split("\n");
  const truncated = aFull.length > DIFF_MAX_LINES || bFull.length > DIFF_MAX_LINES;
  const a = truncated ? aFull.slice(0, DIFF_MAX_LINES) : aFull;
  const b = truncated ? bFull.slice(0, DIFF_MAX_LINES) : bFull;
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i]!;
      const nextRow = lcs[i + 1]!;
      row[j] = a[i] === b[j] ? nextRow[j + 1]! + 1 : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "context", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ type: "removed", text: a[i]! });
      i++;
    } else {
      result.push({ type: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "removed", text: a[i]! });
    i++;
  }
  while (j < m) {
    result.push({ type: "added", text: b[j]! });
    j++;
  }
  return { lines: result, truncated };
}
