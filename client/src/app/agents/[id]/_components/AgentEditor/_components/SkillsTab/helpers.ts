import type { Skill } from "@devdigest/shared";

/** Case-insensitive substring filter over the skill catalog by name. */
export function filterSkillsByName(skills: readonly Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter((sk) => sk.name.toLowerCase().includes(q));
}

/**
 * Reinsert a reordered subset of ids back into their original absolute
 * positions within the full ordered list, leaving every other id in place.
 * Needed when the attached list is reordered while a name filter is hiding
 * some attached skills — only the visible subset's relative order changes,
 * everything else keeps its original slot.
 */
export function reinsertOrder(fullOrder: string[], visibleOrder: string[], newVisibleOrder: string[]): string[] {
  const visibleSet = new Set(visibleOrder);
  const positions: number[] = [];
  fullOrder.forEach((id, i) => {
    if (visibleSet.has(id)) positions.push(i);
  });
  const next = [...fullOrder];
  positions.forEach((pos, i) => {
    const id = newVisibleOrder[i];
    if (id !== undefined) next[pos] = id;
  });
  return next;
}
