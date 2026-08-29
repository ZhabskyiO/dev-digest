import { readFile } from 'node:fs/promises';
import type { CiRunnerBundle } from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';

/**
 * Thrown when the configured runner-bundle path has no file on disk.
 * `agent-runner/dist/` is git-ignored and `pnpm build` (ncc) is the only
 * thing that creates it, so a fresh clone (or CI checkout that skipped the
 * build step) legitimately has none. Failing closed here — rather than
 * exporting an empty/undefined bundle into a customer repo — is deliberate;
 * the message below names both the resolved path and the exact fix.
 */
export class RunnerBundleMissingError extends ConfigError {
  constructor(path: string) {
    super(`Runner bundle not found at ${path} — run: cd agent-runner && pnpm build`);
    this.name = 'RunnerBundleMissingError';
  }
}

/**
 * Reads the agent-runner ncc bundle from a configured absolute path on disk.
 * The file never changes for the lifetime of the process (it is a build
 * artifact, not something a running server mutates), so the contents are
 * read once and cached in memory — this is what keeps Export-to-CI's preview
 * endpoint inside its < 300 ms p95 budget (R12): every call after the first
 * is a plain in-memory string return, no filesystem I/O at all.
 *
 * A missing file is not degraded gracefully — it throws
 * `RunnerBundleMissingError` so the failure is actionable instead of
 * silently shipping an empty/garbage bundle into a target repo's CI.
 */
export class FsCiRunnerBundle implements CiRunnerBundle {
  private cached?: string;

  constructor(private readonly path: string) {}

  async read(): Promise<string> {
    if (this.cached !== undefined) return this.cached;
    let contents: string;
    try {
      contents = await readFile(this.path, 'utf8');
    } catch {
      throw new RunnerBundleMissingError(this.path);
    }
    this.cached = contents;
    return contents;
  }
}
