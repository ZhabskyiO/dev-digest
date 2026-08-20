import type { ProjectContextRef } from "@devdigest/shared";

/** Pure helpers for ContextTab — kept free of hooks/React so they're trivial
 *  to unit-test and reuse from render bodies without re-deriving inline. */

/** Case-insensitive substring filter over a document/attachment list by
 *  clone-relative path (AC-18). Never touches which rows are checked — the
 *  caller's checked state is computed independently of this filter. */
export function filterByPath<T extends { path: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => item.path.toLowerCase().includes(q));
}

/**
 * Applies a drag result to the full ordered ref list.
 *
 * `paths` is only what the list was SHOWING — a filter can hide rows, and an
 * agent can still carry attachments made against another repository. Those
 * refs are not in `paths`, so they are preserved in their existing relative
 * order and appended after the reordered block rather than silently dropped
 * (dropping them would detach documents the user never touched).
 *
 * Refs are matched by path alone, which is what `AttachmentList` keys its rows
 * on; two attachments sharing a path across different repositories would
 * already collide in that list, so this helper is no weaker than the UI above it.
 */
export function reorderRefs(refs: readonly ProjectContextRef[], paths: readonly string[]): ProjectContextRef[] {
  const shown = new Set(paths);
  const byPath = new Map(refs.filter((r) => shown.has(r.path)).map((r) => [r.path, r]));
  const moved = paths.map((p) => byPath.get(p)).filter((r): r is ProjectContextRef => r != null);
  return [...moved, ...refs.filter((r) => !shown.has(r.path))];
}
