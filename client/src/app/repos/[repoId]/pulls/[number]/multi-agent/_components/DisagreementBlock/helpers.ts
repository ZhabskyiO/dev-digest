import type { Conflict, ConflictTake } from "@devdigest/shared";

/**
 * A location group's takes "diverge" when its participating agents did not
 * all land on the exact same verdict — either at least one agent didn't flag
 * it at all (`'ignored'` is itself a distinct verdict value from any
 * `Severity`), or two agents assigned different severities. A group is
 * unanimous — and hidden by "Show only conflicts" — only when every take
 * shares one verdict (AC-29).
 */
export function isDivergent(takes: ConflictTake[]): boolean {
  const verdicts = new Set(takes.map((take) => take.verdict));
  return verdicts.size > 1;
}

export function filterConflicts(conflicts: Conflict[], onlyConflicts: boolean): Conflict[] {
  if (!onlyConflicts) return conflicts;
  return conflicts.filter((group) => isDivergent(group.takes));
}
