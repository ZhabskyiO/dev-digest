import type { BlastSymbol } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

/**
 * Link a caller's `file:line` to GitHub, pinned to the commit the index was
 * built from (`indexed_sha`).
 *
 * NOT the PR's head sha, and not the default branch either. Callers are found
 * by indexing a checkout, so most are files the PR never touches; and the index
 * can lag `main` by any number of commits, so a branch link drifts off by
 * however many lines have been inserted above since it was built. Only the
 * indexed sha makes the line number mean what the card says it means.
 *
 * `defaultBranch` is the fallback for a repo with no index yet — those rows
 * have no trustworthy line numbers anyway. Returns undefined when neither is
 * known, which makes `MonoLink` render plain text instead of a dead link.
 */
export function callerHref(
  repoFullName: string | null,
  indexedSha: string | null,
  defaultBranch: string | null,
  file: string,
  line: number,
): string | undefined {
  const ref = indexedSha ?? defaultBranch;
  if (!repoFullName || !ref) return undefined;
  return githubBlobUrl(repoFullName, ref, file, line);
}

export type GraphNode = {
  id: string;
  label: string;
  column: 0 | 1 | 2;
  x: number;
  y: number;
};
export type GraphEdge = { from: string; to: string };
export type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
};

const COL_X = [10, 250, 500] as const;
const ROW_H = 30;
const TOP = 22;

/**
 * Three fixed columns — changed symbol → caller file → endpoint — laid out
 * deterministically (no force simulation, no layout library). The graph view is
 * a second reading of the same tree, so the same data must always draw the same
 * picture; a physics layout would move nodes between renders for no gain.
 *
 * Only symbols that actually have callers are drawn: an isolated node column
 * would say "no impact" in a view whose whole job is showing reach.
 */
export function layoutGraph(symbols: BlastSymbol[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  let row = 0;

  const place = (id: string, label: string, column: 0 | 1 | 2, atRow: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, column, x: COL_X[column], y: TOP + atRow * ROW_H });
  };

  for (const sym of symbols) {
    if (sym.callers.length === 0) continue;
    const symId = `s:${sym.name}`;
    const symRow = row;
    place(symId, `${sym.name}()`, 0, symRow);

    for (const caller of sym.callers) {
      const callerId = `c:${caller.file}`;
      place(callerId, caller.file.split("/").pop() ?? caller.file, 1, row);
      edges.push({ from: symId, to: callerId });
      row += 1;
    }

    for (const ep of sym.endpoints) {
      const epId = `e:${ep.method} ${ep.path}`;
      place(epId, `${ep.method} ${ep.path}`, 2, symRow);
      // Attribute the endpoint to the symbol, not to a guessed caller: the
      // index says which symbol reaches it, never through which caller.
      edges.push({ from: symId, to: epId });
    }
  }

  const maxY = nodes.reduce((m, n) => Math.max(m, n.y), TOP);
  return { nodes, edges, width: 760, height: maxY + TOP };
}
