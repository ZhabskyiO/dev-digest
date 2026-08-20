/**
 * project-context reader — the untrusted-input boundary of the whole
 * Project Context feature (AC-1, AC-2, AC-3, AC-5, AC-34).
 *
 * Walks a repository clone on disk and returns the markdown documents a
 * DevDigest agent may attach to its prompt. The clone is a checkout of a
 * third-party repository: every path it contains — including directory
 * names and symlink targets — is attacker-controlled. Application layer
 * (fs I/O), NOT pure; the only side effect is reading the local filesystem.
 *
 * Discovery rule (AC-1, AC-34): a file is accepted when EITHER
 *   (a) a *directory* segment of its clone-relative path case-insensitively
 *       matches a configured root (default `specs`, `docs`, `insights`) and
 *       the file itself ends in `.md` — type = the matched root, or
 *   (b) its basename case-insensitively matches a configured conventional
 *       filename (default `insights.md`) — type = that convention's type,
 *       derived from its own basename without extension (`insights.md` ->
 *       `insights`), regardless of which directory it lives in.
 *
 * Exclusion (AC-2): any directory named in EXCLUDED_SEGMENTS is never
 * descended into, so nothing under it is ever a candidate — this is why
 * `clones/other-repo/specs/x.md` never reaches the discovery rule above
 * even though `specs` would otherwise match.
 *
 * Path safety (AC-3): path containment by string prefix is NOT sufficient —
 * a candidate reached via a symlink can lexically look like it is inside
 * the clone while actually resolving outside it. Every accepted candidate
 * is therefore `realpath`-ed and re-checked against the clone root's own
 * realpath, mirroring the two-guard shape in
 * `modules/reviews/intent/docs.ts:65-72` (root realpath'd once up front;
 * candidate realpath'd and compared against it). Symlinked *directories*
 * are never descended into at all, both to avoid symlink cycles and
 * because a directory-level escape is caught the same way a file-level one
 * is — nothing under an unfollowed directory is ever produced as a
 * candidate in the first place.
 *
 * Caps (AC-5): a file over `maxFileBytes` is skipped and counted in
 * `omitted.by_size`; once `maxDocs` accepted documents have been collected,
 * further matches are skipped and counted in `omitted.by_count` instead of
 * being added.
 *
 * Every failure — an unreadable directory, a broken symlink, a permission
 * error, a file that vanishes mid-scan — is a skip, never a throw. A racing
 * git checkout or a repo the DevDigest process can't fully read must not
 * fail the whole scan.
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { EXCLUDED_SEGMENTS } from './constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_SEGMENTS);

export interface ScannedDocument {
  /** Clone-relative, POSIX-separated (forward slashes on every platform). */
  path: string;
  /** Derived from the matched root or conventional-filename type. */
  type: string;
  size_bytes: number;
  /** sha256, hex-encoded, over the raw file bytes. */
  content_hash: string;
}

export interface ScanOmitted {
  /** Matching documents dropped once `maxDocs` accepted documents were reached. */
  by_count: number;
  /** Matching documents dropped for exceeding `maxFileBytes`. */
  by_size: number;
}

export interface ScanDocumentsResult {
  documents: ScannedDocument[];
  omitted: ScanOmitted;
}

export interface ScanDocumentsOptions {
  /** Discovery roots (e.g. `specs`, `docs`, `insights`); matched case-insensitively. */
  roots: string[];
  /** Conventional filenames (e.g. `insights.md`); matched case-insensitively. */
  conventionalFilenames: string[];
  /** Discovery cap on the number of documents returned per scan. */
  maxDocs: number;
  /** Discovery cap on a single file's size in bytes. */
  maxFileBytes: number;
}

/**
 * Walks `cloneRoot` recursively and returns the discoverable project-context
 * documents plus counts of what the configured caps omitted. Never throws —
 * a root that doesn't exist or can't be read yields an empty result.
 */
export async function scanDocuments(
  cloneRoot: string,
  opts: ScanDocumentsOptions,
): Promise<ScanDocumentsResult> {
  const documents: ScannedDocument[] = [];
  const omitted: ScanOmitted = { by_count: 0, by_size: 0 };

  // Resolve the clone root's own symlinks once, so every later containment
  // check compares like for like — on macOS a clone under /tmp realpaths to
  // /private/tmp, and comparing a realpath'd candidate against a
  // non-realpath'd root would drop every candidate.
  const realRoot = await realpath(cloneRoot).catch(() => null);
  if (realRoot === null) return { documents, omitted };

  const roots = normalize(opts.roots);
  const conventionTypes = buildConventionTypes(opts.conventionalFilenames);

  await walk(cloneRoot, realRoot, cloneRoot, roots, conventionTypes, opts, documents, omitted);

  return { documents, omitted };
}

function normalize(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
}

/** Maps a lower-cased conventional filename to its document type. */
function buildConventionTypes(filenames: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of filenames) {
    const name = raw.trim().toLowerCase();
    if (name.length === 0) continue;
    const type = path.basename(name, path.extname(name));
    if (type.length === 0) continue;
    map.set(name, type);
  }
  return map;
}

async function walk(
  cloneRoot: string,
  realRoot: string,
  dir: string,
  roots: string[],
  conventionTypes: Map<string, string>,
  opts: ScanDocumentsOptions,
  documents: ScannedDocument[],
  omitted: ScanOmitted,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink, a checkout racing
    // a git operation) — skip cleanly so the scan keeps making progress on
    // the parts of the clone it CAN read.
    return;
  }

  // Stable order so results are deterministic regardless of filesystem
  // iteration order.
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const name = entry.name;
    const full = path.join(dir, name);

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walk(cloneRoot, realRoot, full, roots, conventionTypes, opts, documents, omitted);
      continue;
    }

    if (entry.isSymbolicLink()) {
      // A symlink Dirent doesn't carry the target's type — resolve one hop
      // to find out. A broken link (target missing/unreadable) is a skip.
      const targetStat = await stat(full).catch(() => null);
      if (targetStat === null) continue;
      if (targetStat.isDirectory()) {
        // Never descend into a symlinked directory: avoids symlink cycles,
        // and anything under it simply never becomes a candidate — the
        // escape is caught by never looking, not by looking then rejecting.
        continue;
      }
      if (!targetStat.isFile()) continue; // sockets, fifos, etc. via a symlink
    } else if (!entry.isFile()) {
      continue; // sockets, fifos, etc. — never documents
    }

    const type = classify(full, cloneRoot, name, roots, conventionTypes);
    if (type === null) continue;

    // The check that actually matters: resolve every remaining symlink on
    // the path and require the real target to still live under the clone's
    // own realpath. Path containment by string prefix alone is NOT
    // sufficient — see modules/reviews/intent/docs.ts:65-72.
    const real = await realpath(full).catch(() => null);
    if (real === null) continue;
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue;

    let size: number;
    try {
      size = (await stat(real)).size;
    } catch {
      continue;
    }

    if (size > opts.maxFileBytes) {
      omitted.by_size += 1;
      continue;
    }

    if (documents.length >= opts.maxDocs) {
      omitted.by_count += 1;
      continue;
    }

    let raw: Buffer;
    try {
      raw = await readFile(real);
    } catch {
      continue;
    }

    const relPath = path.relative(cloneRoot, full).split(path.sep).join('/');
    const content_hash = createHash('sha256').update(raw).digest('hex');

    documents.push({ path: relPath, type, size_bytes: size, content_hash });
  }
}

/**
 * Decides whether `full` is a discoverable document and, if so, its type.
 * Returns null for anything that matches neither the root rule nor the
 * conventional-filename rule.
 */
function classify(
  full: string,
  cloneRoot: string,
  name: string,
  roots: string[],
  conventionTypes: Map<string, string>,
): string | null {
  const lowerName = name.toLowerCase();

  if (lowerName.endsWith('.md')) {
    const relDir = path.relative(cloneRoot, path.dirname(full));
    if (relDir.length > 0) {
      const segments = relDir.split(path.sep).map((segment) => segment.toLowerCase());
      const matchedRoot = segments.find((segment) => roots.includes(segment));
      if (matchedRoot !== undefined) return matchedRoot;
    }
  }

  const conventionType = conventionTypes.get(lowerName);
  if (conventionType !== undefined) return conventionType;

  return null;
}
