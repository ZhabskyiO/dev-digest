import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDocRefs } from '../src/modules/reviews/intent/docs.js';

/**
 * `readDocRefs` reads files named in an attacker-controlled PR body out of an
 * attacker-controlled clone. Hermetic — a real temp directory, no DB, no
 * network. Both halves of the guard are asserted: the lexical one (the ref
 * itself escapes) and the filesystem one (the ref is innocent, the file it
 * names is a symlink pointing out of the clone).
 */
describe('readDocRefs containment', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'devdigest-intent-docs-'));
    root = path.join(base, 'clone');
    outside = path.join(base, 'secrets.json');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs', 'plan.md'), '# real doc', 'utf8');
    await writeFile(outside, '{"anthropic":"sk-secret"}', 'utf8');
    await symlink(outside, path.join(root, 'docs', 'leak.md'));
  });

  afterAll(async () => {
    await rm(path.dirname(root), { recursive: true, force: true });
  });

  it('reads a doc that really lives inside the clone', async () => {
    expect(await readDocRefs(root, ['docs/plan.md'])).toEqual([
      { path: 'docs/plan.md', body: '# real doc' },
    ]);
  });

  it('drops a ref whose file is a symlink out of the clone', async () => {
    // The ref is lexically innocent — the escape is entirely in the clone's
    // contents, which is why resolving the path is not enough on its own.
    expect(await readDocRefs(root, ['docs/leak.md'])).toEqual([]);
  });

  it('drops a traversing ref and a missing file', async () => {
    expect(await readDocRefs(root, ['../secrets.json', 'docs/absent.md'])).toEqual([]);
  });

  it('degrades to no evidence when the repo has no clone', async () => {
    expect(await readDocRefs(null, ['docs/plan.md'])).toEqual([]);
  });
});
