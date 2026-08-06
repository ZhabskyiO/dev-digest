export type DiffKind = "same" | "add" | "del";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the "before" text, null on an added line. */
  oldNo: number | null;
  /** 1-based line number in the "after" text, null on a removed line. */
  newNo: number | null;
}

/**
 * Line diff via a classic LCS table. No dependency: skill bodies are hundreds
 * of lines, so the O(n·m) table is far cheaper than pulling in a diff library,
 * and being pure makes it directly unit-testable.
 *
 * Rows come back in "after" order with removals interleaved at the point they
 * disappeared, which is what a reader scanning a unified diff expects.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i]!;
      const next = lcs[i + 1]!;
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i]!, oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
      continue;
    }
    // Follow the larger remaining subsequence; ties drop the "before" line
    // first so a replacement reads as removal-then-addition.
    if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      rows.push({ kind: "del", text: a[i]!, oldNo: i + 1, newNo: null });
      i += 1;
    } else {
      rows.push({ kind: "add", text: b[j]!, oldNo: null, newNo: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    rows.push({ kind: "del", text: a[i]!, oldNo: i + 1, newNo: null });
    i += 1;
  }
  while (j < b.length) {
    rows.push({ kind: "add", text: b[j]!, oldNo: null, newNo: j + 1 });
    j += 1;
  }
  return rows;
}

/** True when the two texts are line-for-line identical. */
export function isIdentical(rows: DiffRow[]): boolean {
  return rows.every((r) => r.kind === "same");
}

/**
 * Drop long runs of unchanged lines, keeping `context` either side of every
 * change — otherwise a one-line edit to a 200-line body renders 200 rows.
 */
export function collapseUnchanged(rows: DiffRow[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, idx) => {
    if (row.kind === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k += 1) {
      keep[k] = true;
    }
  });
  return rows.filter((_, idx) => keep[idx]);
}
