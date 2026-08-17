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
  /** Pre-wrapped: one entry per rendered line. */
  lines: string[];
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

const COL_X = [10, 204, 400] as const;
const LINE_H = 13;
const NODE_GAP = 11;
/** Vertical space between one changed symbol's band and the next. */
const BAND_GAP = 16;
const TOP = 16;
/** Chars per line at 11px in the mono stack, chosen so the widest wrapped
    label lands inside a ~640px card without a horizontal scrollbar. */
const MAX_CHARS = 26;
const MAX_LINES = 3;
const CHAR_W = 6.2;

/**
 * Break a label into at most MAX_LINES rendered lines.
 *
 * SVG `<text>` does not wrap — it draws one run and lets it overflow whatever
 * is beside it. An endpoint like `POST /articles/${id}/publish` is well past
 * the column width, so without this every long label collides with its
 * neighbours into an unreadable smear.
 *
 * Breaks after `/` where possible so a route path splits at its segments and
 * stays recognisable; falls back to a hard chunk for a long unbroken run.
 */
export function wrapLabel(label: string, maxChars = MAX_CHARS): string[] {
  if (label.length <= maxChars) return [label];

  const lines: string[] = [];
  let rest = label;
  while (rest.length > maxChars && lines.length < MAX_LINES - 1) {
    // Prefer the last segment boundary inside the budget; `+ 1` keeps the `/`
    // on the line it ends, which reads as "continues below".
    const cut = rest.lastIndexOf("/", maxChars);
    const at = cut > maxChars / 3 ? cut + 1 : maxChars;
    lines.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  lines.push(rest.length > maxChars ? `${rest.slice(0, maxChars - 1)}…` : rest);
  return lines;
}

/**
 * Three fixed columns — changed symbol → caller file → endpoint — laid out
 * deterministically (no force simulation, no layout library). The graph view is
 * a second reading of the same tree, so the same data must always draw the same
 * picture; a physics layout would move nodes between renders for no gain.
 *
 * Each symbol gets a horizontal BAND. Callers and endpoints advance their own
 * cursors inside it, so every node owns its vertical space — placing a
 * symbol's endpoints all on one row (as this did originally) draws them on top
 * of each other. The symbol node is centred against the taller of its two
 * columns. An endpoint reached by several symbols is placed once and gains
 * another edge, so shared routes read as shared.
 *
 * Only symbols that actually have callers or endpoints are drawn: an isolated
 * node column would say "no impact" in a view whose whole job is showing reach.
 */
export function layoutGraph(symbols: BlastSymbol[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const placed = new Map<string, GraphNode>();
  let y = TOP;

  const place = (id: string, label: string, column: 0 | 1 | 2, at: number): GraphNode => {
    const existing = placed.get(id);
    if (existing) return existing;
    const node: GraphNode = { id, lines: wrapLabel(label), column, x: COL_X[column], y: at };
    placed.set(id, node);
    nodes.push(node);
    return node;
  };
  const heightOf = (label: string) => wrapLabel(label).length * LINE_H + NODE_GAP;

  for (const sym of symbols) {
    if (sym.callers.length === 0 && sym.endpoints.length === 0) continue;
    const bandTop = y;
    let yCallers = bandTop;
    let yEndpoints = bandTop;
    const symId = `s:${sym.file}:${sym.name}`;
    const childIds: string[] = [];

    for (const caller of sym.callers) {
      const id = `c:${caller.file}`;
      const label = caller.file.split("/").pop() ?? caller.file;
      if (!placed.has(id)) {
        place(id, label, 1, yCallers);
        yCallers += heightOf(label);
      }
      childIds.push(id);
    }

    for (const ep of sym.endpoints) {
      const label = `${ep.method} ${ep.path}`;
      const id = `e:${label}`;
      if (!placed.has(id)) {
        place(id, label, 2, yEndpoints);
        yEndpoints += heightOf(label);
      }
      childIds.push(id);
    }

    const bandBottom = Math.max(yCallers, yEndpoints, bandTop + LINE_H + NODE_GAP);
    const symLabel = `${sym.name}()`;
    const symNode = place(
      symId,
      symLabel,
      0,
      // Centred on its band, but never above it — a one-caller symbol should
      // sit level with that caller, not float half a row up.
      Math.max(bandTop, (bandTop + bandBottom - heightOf(symLabel)) / 2),
    );
    for (const id of childIds) edges.push({ from: symNode.id, to: id });
    y = bandBottom + BAND_GAP;
  }

  const widest = nodes.reduce(
    (w, n) => Math.max(w, n.x + Math.max(...n.lines.map((l) => l.length)) * CHAR_W),
    0,
  );
  return { nodes, edges, width: Math.ceil(widest) + 16, height: Math.max(y, TOP) };
}
