/* helpers.ts — a small, pure line-level differ for DriftCompare (AC-38).
   Classic LCS backtrack, no dependency: the inputs are a single markdown
   document each, capped at the server's preview limit (a few hundred lines
   at most), so the O(n·m) table is cheap. */

export type DiffLineType = "context" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** Line-level diff of `previous` → `current`. Lines equal on both sides are
 *  `context`; a line only in `previous` is `removed`; a line only in
 *  `current` is `added`. Order is preserved as a human reads it top to
 *  bottom — not grouped by type. */
export function diffLines(previous: string, current: string): DiffLine[] {
  const a = previous.split("\n");
  const b = current.split("\n");
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
  return result;
}
