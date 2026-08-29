import type { AgentColumn, AgentColumnFinding, Conflict, ConflictTake } from '@devdigest/shared';

/**
 * T5 — the pure cross-agent grouper (`buildLocationGroups`). No I/O: no
 * DI composition root, no database, no LLM. Consumed by T10's multi-agent
 * service, which is the only caller allowed to know where
 * `columns`/`rejections` come from.
 *
 * Merge rule: two findings become one group when they share a `file` AND
 * their inclusive `[start_line, end_line]` ranges intersect AND they were
 * raised by different RUNS (`run_id`, not `agent_id` — see the note on
 * `GroupingColumn.run_id` below). Only a DIRECT pairwise merge is blocked
 * between two same-run findings — the merge graph is still closed
 * transitively (union-find), so a group CAN end up holding more than one
 * finding from the same run when a third run's finding bridges them
 * (e.g. A:10-10, B:10-20, A:15-15 all end up in one group). That is
 * intentional and matches the take rule below ("worst severity wins if
 * several"), which already anticipates more than one member per run.
 */

/**
 * A single input column: only the fields grouping needs, not the full
 * `AgentColumn`.
 *
 * `run_id` (not `agent_id`) is this module's MERGE/ATTRIBUTION identity key.
 * `agent_id` is deliberately NOT unique across columns: when an agent is
 * deleted (FK `SET NULL` on `agent_runs.agent_id`), the caller maps every
 * such run's `agent_id` to the same `''` placeholder (service.ts's
 * `buildColumn`). Keying merge/take logic off `agent_id` would then treat
 * every deleted-agent column as ONE pseudo-agent: their findings would never
 * merge with each other (the same-agent-pair-never-merges rule firing on an
 * accidental collision), and a `ConflictTake` built per `agent_id` would
 * conflate multiple real agents' findings into a single duplicated take.
 * `run_id` is always genuinely unique per column, so it carries both the
 * merge-blocking rule and the rejection lookup without that collision.
 * `agent_id`/`agent_name` stay on this shape purely for attribution
 * (surfaced verbatim on the output `ConflictTake`).
 */
export interface GroupingColumn {
  run_id: string;
  agent_id: string;
  agent_name: string;
  status: AgentColumn['status'];
  findings: AgentColumnFinding[];
}

/** A grounding-gate rejection at a location, as recorded for one agent's run. */
export interface GroupingRejection {
  file: string;
  start_line: number;
  end_line: number;
  reason: string;
}

/**
 * `rejections` is keyed by `run_id`, NOT `agent_id`. A `ConflictTake` is
 * correlated by COLUMN (one take per done column per group), and `run_id` is
 * always unique per column even when `agent_id` isn't (a deleted agent's
 * columns all report `agent_id: ''` — see the note on `GroupingColumn` above).
 * Within one multi-agent run each agent contributes at most one run today, so
 * this is not a behavior change for a normal (agent still exists) column;
 * it only changes lookup for the deleted-agent case, where a rejection is now
 * correctly matched to the one column that produced it instead of being
 * shared across every deleted-agent column keyed under the same `''`.
 * Callers building this map from persisted grounding-gate rejections should
 * key their own lookup by `run_id`.
 */
export interface BuildLocationGroupsInput {
  columns: GroupingColumn[];
  rejections: Map<string, GroupingRejection[]>;
}

/** Rank table for "worst severity wins" — typed against the real verdict union
 * (`Conflict['takes'][number]['verdict']`, i.e. `Severity | 'ignored'`) so a
 * typo'd key (e.g. a lowercase tier) is a compile error rather than a
 * silently-equal rank (`server/insights/gotchas.md` 2026-08-21). */
const VERDICT_RANK: Record<ConflictTake['verdict'], number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
  ignored: 0,
};

interface GroupedItem {
  finding: AgentColumnFinding;
  runId: string;
  agentName: string;
}

/** Minimal union-find (disjoint set) with path compression, no union-by-rank
 * needed at this scale (findings within one PR's multi-run). */
class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let cur = x;
    while (true) {
      const p = this.parent[cur];
      if (p === undefined || p === cur) return cur;
      const grandparent = this.parent[p];
      if (grandparent !== undefined) this.parent[cur] = grandparent; // path compression
      cur = p;
    }
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootA] = rootB;
  }
}

function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function worstSeverity(severities: AgentColumnFinding['severity'][]): AgentColumnFinding['severity'] {
  let worst: AgentColumnFinding['severity'] | undefined;
  let worstRank = -1;
  for (const severity of severities) {
    const rank = VERDICT_RANK[severity];
    if (rank > worstRank) {
      worstRank = rank;
      worst = severity;
    }
  }
  // Only called with a non-empty `severities` (guarded by the caller), so
  // `worst` is always assigned; the fallback exists purely to satisfy
  // noUncheckedIndexedAccess-style strictness without an unsafe `!`.
  return worst ?? 'SUGGESTION';
}

function findRejectionReason(
  entries: GroupingRejection[] | undefined,
  file: string,
  startLine: number,
  endLine: number,
): string | null {
  if (!entries) return null;
  for (const entry of entries) {
    if (entry.file === file && rangesIntersect(entry.start_line, entry.end_line, startLine, endLine)) {
      return entry.reason;
    }
  }
  return null;
}

function buildConflict(
  members: GroupedItem[],
  doneColumns: GroupingColumn[],
  rejections: Map<string, GroupingRejection[]>,
): Conflict {
  const first = members[0];
  if (!first) throw new Error('buildConflict called with an empty member list');
  const file = first.finding.file;

  let startLine = first.finding.start_line;
  let endLine = first.finding.end_line;
  for (const member of members) {
    startLine = Math.min(startLine, member.finding.start_line);
    endLine = Math.max(endLine, member.finding.end_line);
  }

  // Deterministic title: the lowest-agent_name, lowest-start_line member.
  const titleHolder = [...members].sort((a, b) => {
    if (a.agentName !== b.agentName) return a.agentName < b.agentName ? -1 : 1;
    return a.finding.start_line - b.finding.start_line;
  })[0];
  const title = titleHolder ? titleHolder.finding.title : '';

  const takes: ConflictTake[] = doneColumns.map((col) => {
    const columnMembers = members.filter((m) => m.runId === col.run_id);
    if (columnMembers.length > 0) {
      return {
        agent_id: col.agent_id,
        agent_name: col.agent_name,
        verdict: worstSeverity(columnMembers.map((m) => m.finding.severity)),
        note: null,
      } satisfies ConflictTake;
    }
    return {
      agent_id: col.agent_id,
      agent_name: col.agent_name,
      verdict: 'ignored',
      note: findRejectionReason(rejections.get(col.run_id), file, startLine, endLine),
    } satisfies ConflictTake;
  });

  takes.sort((a, b) => (a.agent_name < b.agent_name ? -1 : a.agent_name > b.agent_name ? 1 : 0));

  return { file, start_line: startLine, end_line: endLine, title, takes };
}

/**
 * Groups findings from `done` agent columns that occupy the same (or
 * intersecting) file/line-range, and emits one `Conflict` per resulting
 * group with a `ConflictTake` for every `done` agent — including agents that
 * did not flag that location (`verdict: 'ignored'`). `failed`/`cancelled`
 * columns are excluded entirely: they contribute no take to any group.
 *
 * Pure and synchronous: no DI composition root, no database, no LLM.
 */
export function buildLocationGroups(input: BuildLocationGroupsInput): Conflict[] {
  const doneColumns = input.columns.filter((c) => c.status === 'done');
  if (doneColumns.length === 0) return [];

  const items: GroupedItem[] = [];
  for (const col of doneColumns) {
    for (const finding of col.findings) {
      items.push({ finding, runId: col.run_id, agentName: col.agent_name });
    }
  }
  if (items.length === 0) return [];

  const uf = new UnionFind(items.length);
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (!b) continue;
      if (a.runId === b.runId) continue; // same-run pair never merges
      if (a.finding.file !== b.finding.file) continue;
      if (
        !rangesIntersect(a.finding.start_line, a.finding.end_line, b.finding.start_line, b.finding.end_line)
      ) {
        continue;
      }
      uf.union(i, j);
    }
  }

  const groupsByRoot = new Map<number, GroupedItem[]>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const root = uf.find(i);
    const bucket = groupsByRoot.get(root);
    if (bucket) bucket.push(item);
    else groupsByRoot.set(root, [item]);
  }

  const conflicts: Conflict[] = [];
  for (const members of groupsByRoot.values()) {
    conflicts.push(buildConflict(members, doneColumns, input.rejections));
  }

  conflicts.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.start_line !== b.start_line) return a.start_line - b.start_line;
    return a.end_line - b.end_line;
  });

  return conflicts;
}
