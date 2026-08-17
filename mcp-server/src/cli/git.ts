/**
 * git plumbing for the CLI — the ONLY place that shells out to git.
 *
 * Everything here is read-only: no `add`, no `stash`, no index writes. A
 * pre-push review must never mutate the working tree it is reviewing (which
 * rules out the usual `git add -N .` trick for making untracked files show up
 * in `git diff`).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);

/** Thrown when git itself is unusable (not installed, not a repo, …). */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Untracked files above this size are skipped rather than diffed. A 512 KB
 * fixture or build artifact would blow the model's context for no review value,
 * and the CLI reports every skip rather than silently shrinking the change-set.
 */
const MAX_UNTRACKED_BYTES = 256 * 1024;

/**
 * Run git in `cwd`. `git diff --no-index` exits 1 when files differ, which is
 * success for us, so exit code 1 is tolerated when `tolerateExit1` is set.
 */
async function git(
  cwd: string,
  args: string[],
  opts: { tolerateExit1?: boolean } = {},
): Promise<string> {
  try {
    // maxBuffer: a whole working-tree diff routinely exceeds Node's 1 MB default.
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message: string };
    if (opts.tolerateExit1 && e.code === 1 && typeof e.stdout === 'string') return e.stdout;
    const detail = (e.stderr ?? e.message).trim();
    throw new GitError(`git ${args.join(' ')} failed: ${detail}`);
  }
}

/** Absolute path of the enclosing repository's root. */
export async function repoRoot(cwd: string): Promise<string> {
  const out = await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => {
    throw new GitError(
      `Not inside a git repository (${cwd}). Run devdigest from a working copy.`,
    );
  });
  return out.trim();
}

/** True when the repo has at least one commit (a fresh `git init` does not). */
async function hasHead(root: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** Short label for the change-set, e.g. `dev-digest @ 1ba9516 (Lab-4)`. */
export async function describeHead(root: string): Promise<string> {
  const name = root.split('/').filter(Boolean).pop() ?? 'repo';
  if (!(await hasHead(root))) return `${name} @ (no commits yet)`;
  const sha = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim();
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  return `${name} @ ${sha} (${branch})`;
}

/** The repo's `owner/name` from its `origin` remote, when it has one. */
export async function originFullName(root: string): Promise<string | undefined> {
  let url: string;
  try {
    url = (await git(root, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    return undefined;
  }
  // git@host:owner/name.git · ssh://host/owner/name · https://host/owner/name.git
  const match = url.replace(/\.git$/, '').match(/[:/]([^/:]+)\/([^/]+)$/);
  if (!match) return undefined;
  return `${match[1]}/${match[2]}`;
}

export type CollectedDiff = {
  /** Unified diff text, ready to POST. Empty when there is nothing to review. */
  diff: string;
  /** Paths included, in diff order. */
  files: string[];
  /** Paths deliberately left out, each with the reason — always reported. */
  skipped: { path: string; reason: string }[];
};

/**
 * The `working` change-set: everything not yet committed.
 *
 *  - `git diff HEAD` covers staged AND unstaged edits to TRACKED files.
 *  - Untracked files are invisible to that command, so each one is diffed
 *    separately against /dev/null (`--no-index`), which yields exactly the
 *    "new file" hunks the reviewer's grounding gate expects. `.gitignore` is
 *    honoured via `--exclude-standard`. Pass `untracked: false` to leave them
 *    out entirely.
 *
 * Not included, by design: file DELETIONS. A deleted file's diff has no
 * new-side lines, so no finding could ever be grounded on it, and the server's
 * parser drops it for PRs too — same behaviour, no surprise.
 */
export async function collectWorkingTreeDiff(
  root: string,
  opts: { untracked: boolean },
): Promise<CollectedDiff> {
  const parts: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  if (await hasHead(root)) {
    const tracked = await git(root, ['diff', 'HEAD']);
    if (tracked.trim()) parts.push(tracked.replace(/\n*$/, '\n'));
  }

  if (opts.untracked) {
    const listed = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const path of listed.split('\0').filter(Boolean)) {
      let size: number;
      try {
        size = (await stat(join(root, path))).size;
      } catch {
        // Vanished between listing and stat (build output, editor temp file).
        skipped.push({ path, reason: 'disappeared while collecting the diff' });
        continue;
      }
      if (size > MAX_UNTRACKED_BYTES) {
        skipped.push({ path, reason: `untracked file larger than ${MAX_UNTRACKED_BYTES / 1024} KB` });
        continue;
      }
      const out = await git(root, ['diff', '--no-index', '--', '/dev/null', path], {
        tolerateExit1: true,
      });
      if (!out.trim()) continue;
      if (isBinaryDiff(out)) {
        skipped.push({ path, reason: 'binary file' });
        continue;
      }
      parts.push(out.replace(/\n*$/, '\n'));
    }
  }

  const diff = parts.join('');
  return { diff, files: filePathsIn(diff), skipped };
}

/**
 * Does this single-file diff describe a binary file?
 *
 * Anchored to the START of a line, and paired with "has no hunks at all":
 * a naive `out.includes('Binary files ')` also matches a SOURCE line that
 * happens to contain the phrase, since added lines are just the file's text
 * with a `+` in front — which is exactly how this function's own file first
 * got reported as binary.
 */
function isBinaryDiff(out: string): boolean {
  const lines = out.split('\n');
  if (lines.some((l) => l.startsWith('@@ '))) return false;
  return lines.some((l) => l.startsWith('Binary files ') && l.trimEnd().endsWith('differ'));
}

/** New-side paths in a unified diff, in order (`+++ b/path`). */
export function filePathsIn(diff: string): string[] {
  const out: string[] = [];
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+++ ')) continue;
    const path = line.slice(4).trim().replace(/^b\//, '');
    if (path !== '/dev/null') out.push(path);
  }
  return out;
}
