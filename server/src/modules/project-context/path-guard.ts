/**
 * project-context — shared symlink-escape containment guard (AC-3, AC-22).
 *
 * This is the ONE place that decides whether a clone-relative path is safe to
 * read. Both `ProjectContextService` (`service.ts`) and `resolveProjectContext`
 * (`../reviews/prompt-context.ts`) delegate here rather than keeping their own
 * copy — the whole feature's threat model rests on this check, and two copies
 * could silently drift apart on the next edit.
 *
 * Deliberately pure and side-effect-free beyond the filesystem reads the check
 * itself requires: no DB, no container, no logging. `reader.ts` has its own
 * inline containment check for a different purpose (scanning a whole tree,
 * not resolving one path) and is NOT a duplicate of this guard — it stays as
 * is.
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolves `relPath` against `realRoot`, requiring the REAL (symlinks
 * resolved) target to still live under it — path containment by string
 * prefix alone is not sufficient, since a candidate can look inside the
 * clone lexically while a symlink resolves it outside.
 *
 * `realRoot` MUST already be `realpath()`-resolved by the caller (e.g. via
 * `realpath(clonePath)`) — on macOS a `/tmp` clone realpaths to `/private/tmp`,
 * and comparing unlike forms drops everything. This function does not
 * realpath the root itself, so a caller resolving many `relPath`s against the
 * same clone (as `resolveProjectContext` does) pays that cost only once.
 *
 * Never throws — returns `null` for anything that fails any check: an
 * absolute `relPath`, a `..` traversal, or a symlink whose real target
 * escapes `realRoot`.
 */
export async function resolveInClone(realRoot: string, relPath: string): Promise<string | null> {
  if (relPath.includes('..') || relPath.startsWith('/')) return null;

  const resolved = path.resolve(realRoot, relPath);
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) return null;

  const real = await realpath(resolved).catch(() => null);
  if (real === null) return null;
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;

  return real;
}
