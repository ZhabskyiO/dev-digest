import type { ProjectContextRef } from "@devdigest/shared";

/** Order-sensitive equality for two attachment-ref lists — used to decide
 *  whether the local draft differs from the persisted set (Save enablement).
 *  `noUncheckedIndexedAccess` makes `b[i]` possibly `undefined`, which also
 *  correctly reads as "not equal" when the lengths already matched but the
 *  slot is somehow missing. */
export function refsEqual(a: ProjectContextRef[], b: ProjectContextRef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ref, i) => {
    const other = b[i];
    return other !== undefined && other.repo_id === ref.repo_id && other.path === ref.path;
  });
}

/**
 * Applies a drag result to the skill's draft ref list.
 *
 * Only refs belonging to `repoId` AND named in `paths` move; everything else —
 * a row hidden by the filter, or an attachment carried from another
 * repository — keeps its ORIGINAL index slot rather than following the
 * reordered block. A skill may legitimately hold refs from several
 * repositories even though only the active repo's documents are browsable,
 * and this list is the prompt injection order (the tail is what gets dropped
 * first once the token budget is exceeded) — so a reorder must never drop
 * an untouched ref, and must never silently relocate it either.
 */
export function reorderDraft(
  draft: readonly ProjectContextRef[],
  repoId: string,
  paths: readonly string[],
): ProjectContextRef[] {
  const shown = new Set(paths);
  const isMoved = (r: ProjectContextRef) => r.repo_id === repoId && shown.has(r.path);
  const byPath = new Map(draft.filter(isMoved).map((r) => [r.path, r]));
  const moved = paths.map((p) => byPath.get(p)).filter((r): r is ProjectContextRef => r != null);
  let cursor = 0;
  return draft.map((r) => (isMoved(r) ? moved[cursor++] : r)).filter((r): r is ProjectContextRef => r != null);
}
