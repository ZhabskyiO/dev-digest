import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reads in-repo doc/spec files named in a PR body — the (c) tier of Intent
 * Layer evidence. Application layer (fs I/O), NOT pure.
 *
 * Security is the whole point of this file: `refs` come from
 * `extractDocRefs()` run over an attacker-controlled PR body. `extractDocRefs`
 * already rejects `..` and leading `/` as defence in depth, but `path.join`
 * alone does NOT prevent traversal (`path.join(root, '../../etc/passwd')`
 * silently escapes `root`) — the only check that actually matters is
 * resolving the path and asserting the result stays under `clonePath`, done
 * here a second time regardless of what the caller already filtered.
 *
 * The lexical check alone is NOT enough, because the clone's *contents* are
 * attacker-controlled too: git happily stores a symlink, so `docs/notes.md`
 * inside an imported repo can point at `~/.devdigest/secrets.json`, and
 * `readFile` follows it. Every path is therefore `realpath`-ed and re-checked
 * against the realpath of the clone root before it is read — a ref that
 * resolves outside the clone is dropped like any other bad ref.
 *
 * A ref failing any check is silently dropped, never thrown — this mirrors
 * `readClone()` in `modules/conventions/service.ts:209-233`, which treats a
 * missing/unreadable file as "skip it", not an error.
 */

export const MAX_DOCS = 3;
export const MAX_DOC_CHARS = 8000;

export interface DocRefBody {
  path: string;
  body: string;
}

export async function readDocRefs(
  clonePath: string | null,
  refs: string[],
): Promise<DocRefBody[]> {
  // `repos.clonePath` is nullable (repo not cloned yet) — see the guard at
  // modules/conventions/service.ts:88. Never throw; intent derivation must
  // degrade to "no evidence" here, not fail the caller.
  if (clonePath === null) return [];

  /* Resolve the root's own symlinks once, so containment is compared like for
     like — on macOS a clone under `/tmp` realpaths to `/private/tmp`, and
     comparing a realpath against a non-realpath root would drop every ref. */
  const root = await realpath(clonePath).catch(() => null);
  if (root === null) return [];

  const out: DocRefBody[] = [];

  for (const rel of refs) {
    if (out.length >= MAX_DOCS) break;

    // Reject up front — cheap, and covers the common case before we ever
    // touch the filesystem.
    if (rel.includes('..') || rel.startsWith('/')) continue;

    // The check that actually matters: resolve, then assert the resolved
    // path is still inside clonePath. path.join()/string prefixes alone are
    // not sufficient — resolution can still walk out via `..` segments that
    // survive naive checks, or via absolute-looking segments on some
    // platforms. This is the one true guard.
    const resolved = path.resolve(root, rel);
    if (!resolved.startsWith(root + path.sep)) continue;

    // Second guard, against the clone's own contents: follow every symlink on
    // the path and require the real target to still live under the clone. A
    // missing file fails this too, and is dropped exactly like a bad ref.
    const real = await realpath(resolved).catch(() => null);
    if (real === null || !real.startsWith(root + path.sep)) continue;

    const raw = await readFile(real, 'utf8').catch(() => null);
    if (raw === null) continue;

    out.push({ path: rel, body: raw.slice(0, MAX_DOC_CHARS) });
  }

  return out;
}
