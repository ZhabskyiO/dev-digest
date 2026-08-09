/**
 * Finding annotations for the diff viewer — the join between a review's
 * findings and the lines this viewer renders.
 *
 * Optional throughout: the Files-changed tab renders the same `DiffViewer`
 * before any review has run, and every consumer that passes no annotations
 * gets exactly the previous behaviour.
 */
import type { FindingRecord } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";

/** A finding reduced to what a diff line needs to show and link to. */
export interface LineFinding {
  id: string;
  severity: Severity;
  title: string;
}

/** Every finding in one file, indexed by the line it is anchored to. */
export interface FileAnnotations {
  /** `start_line` → findings on that line. */
  byLine: Map<number, LineFinding[]>;
  /** Total findings in the file — the header badge's count. */
  total: number;
  /** Lines carrying a finding, ascending. First entry is the scroll target. */
  lines: number[];
}

/**
 * DOM id for one rendered diff line.
 *
 * Anchored on the NEW-side line number because that is what a finding's
 * `start_line` refers to. Deleted lines have no new number and so are never
 * finding targets — consistent with the server's grounding gate, which only
 * cites added/context lines.
 */
export function diffLineAnchorId(path: string, line: number): string {
  return `diffline:${path}:${line}`;
}

/**
 * Index one file's findings by line.
 *
 * `findings` is the full set for the PR; filtering by path here keeps every
 * caller from having to pre-bucket, and the cost is trivial at PR scale.
 */
export function annotationsFor(
  path: string,
  findings: readonly FindingRecord[],
): FileAnnotations {
  const byLine = new Map<number, LineFinding[]>();
  let total = 0;

  for (const f of findings) {
    if (f.file !== path) continue;
    total++;
    const entry: LineFinding = {
      id: f.id,
      severity: f.severity as Severity,
      title: f.title,
    };
    const bucket = byLine.get(f.start_line);
    if (bucket) bucket.push(entry);
    else byLine.set(f.start_line, [entry]);
  }

  return { byLine, total, lines: [...byLine.keys()].sort((a, b) => a - b) };
}
