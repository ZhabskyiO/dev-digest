import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile as realReadFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsCiRunnerBundle, RunnerBundleMissingError } from './fs.js';

describe('FsCiRunnerBundle', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads the configured file and returns its contents', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ci-runner-bundle-'));
    const path = join(dir, 'index.js');
    await writeFile(path, '// bundle contents\n', 'utf8');

    const bundle = new FsCiRunnerBundle(path);
    await expect(bundle.read()).resolves.toBe('// bundle contents\n');
  });

  it('throws RunnerBundleMissingError naming the path and the build command when the file is absent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ci-runner-bundle-'));
    const path = join(dir, 'does-not-exist.js');

    const bundle = new FsCiRunnerBundle(path);
    await expect(bundle.read()).rejects.toThrow(RunnerBundleMissingError);
    await expect(bundle.read()).rejects.toThrow(
      /cd agent-runner && pnpm build/,
    );
    await expect(bundle.read()).rejects.toThrow(path);
  });

  it('reads the file from disk exactly once across multiple read() calls (in-memory cache)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ci-runner-bundle-'));
    const path = join(dir, 'index.js');
    await writeFile(path, 'first', 'utf8');

    const bundle = new FsCiRunnerBundle(path);
    const first = await bundle.read();
    // Mutate the file on disk after the first read — if the second read hit
    // the filesystem again it would observe this new content instead of the
    // cached value.
    await writeFile(path, 'second', 'utf8');
    const second = await bundle.read();

    expect(first).toBe('first');
    expect(second).toBe('first');

    // Sanity check the mutation actually landed on disk (proves the cache,
    // not a filesystem-write failure, is why `second` didn't change).
    await expect(realReadFile(path, 'utf8')).resolves.toBe('second');
  });
});
