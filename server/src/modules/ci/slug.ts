/**
 * Slug normalisation for exported manifest/skill filenames.
 *
 * `agent-runner`'s `loadSkillBodies` (agent-runner/src/skills.ts) enforces
 * `^[a-zA-Z0-9_-]+$` on every skill slug it resolves to a filesystem path, and
 * rejects (hard runner failure) any slug that doesn't match or that resolves
 * outside `.devdigest/skills/` — so a name that doesn't already fit that shape
 * MUST be normalised here, before it is ever written into a manifest (AC-17).
 * A name that normalises to nothing (e.g. all-unsafe characters) is rejected
 * at generation time via `InvalidSlugError` rather than silently emitting an
 * empty or out-of-shape slug.
 */

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;
/** Any run of characters NOT in the safe slug alphabet collapses to one `-`. */
const UNSAFE_RUN = /[^a-zA-Z0-9_-]+/g;

export class InvalidSlugError extends Error {
  constructor(name: string) {
    super(`Name "${name}" normalises to an empty slug`);
    this.name = 'InvalidSlugError';
  }
}

/**
 * Normalise `name` into a slug matching `^[a-zA-Z0-9_-]+$`: lowercase, collapse
 * every run of unsafe characters (anything outside `[a-zA-Z0-9_-]`, including
 * path separators like `/` and `..`) to a single `-`, then trim leading/
 * trailing `-`. Throws `InvalidSlugError` when nothing safe survives — e.g. a
 * name made entirely of punctuation/whitespace never emits an empty or
 * out-of-shape slug (AC-17: "a hostile name like `../../etc/passwd`
 * normalises rather than escapes").
 */
export function toSlug(name: string): string {
  const collapsed = name.toLowerCase().replace(UNSAFE_RUN, '-');
  const trimmed = collapsed.replace(/^-+/, '').replace(/-+$/, '');
  if (trimmed.length === 0 || !SAFE_SLUG.test(trimmed)) {
    throw new InvalidSlugError(name);
  }
  return trimmed;
}

/**
 * Slugify a list of names IN ORDER, deduplicating collisions deterministically
 * with a `-2`, `-3`, … suffix — ordering comes from the input array (the
 * agent's persisted skill order), never from `Map` iteration or any
 * clock/random source, so the same input always produces the same output
 * (AC-19). Dedup is against every slug EMITTED SO FAR, not merely a per-base
 * occurrence count: a naive `-${count}` suffix can collide with an already
 * emitted LITERAL slug (`['a', 'a', 'a-2']` would otherwise produce
 * `['a', 'a-2', 'a-2']` — two files silently sharing one path, one skill body
 * dropped from the export). The counter instead advances past any candidate
 * already in `emitted` until it lands on one that is actually unused.
 */
export function toUniqueSlugs(names: readonly string[]): string[] {
  const seenCounts = new Map<string, number>();
  const emitted = new Set<string>();
  const slugs: string[] = [];
  for (const name of names) {
    const base = toSlug(name);
    let count = (seenCounts.get(base) ?? 0) + 1;
    let candidate = count === 1 ? base : `${base}-${count}`;
    while (emitted.has(candidate)) {
      count += 1;
      candidate = `${base}-${count}`;
    }
    seenCounts.set(base, count);
    emitted.add(candidate);
    slugs.push(candidate);
  }
  return slugs;
}
