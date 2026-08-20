/**
 * T4 — project-context reader unit tests (AC-1, AC-2, AC-3, AC-5, AC-34).
 *
 * Hermetic — a real temp directory on disk, no DB, no network. Mirrors the
 * symlink-containment pattern already proven in `intent-docs.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanDocuments, type ScanDocumentsOptions } from '../src/modules/project-context/reader.js';

const DEFAULT_OPTS: ScanDocumentsOptions = {
  roots: ['specs', 'docs', 'insights'],
  conventionalFilenames: ['insights.md'],
  maxDocs: 500,
  maxFileBytes: 1_048_576,
};

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('scanDocuments', () => {
  describe('AC-1, AC-2, AC-3, AC-34 — discovery, exclusion, symlink containment', () => {
    let base: string;
    let root: string;

    beforeAll(async () => {
      base = await mkdtemp(path.join(tmpdir(), 'devdigest-project-context-'));
      root = path.join(base, 'clone');

      await writeFileAt(root, 'specs/a.md', '# spec a');
      await writeFileAt(root, 'docs/nested/b.md', '# doc b');
      await writeFileAt(root, 'pkg/insights/c.md', '# insight c');
      await writeFileAt(root, 'README.md', '# readme');
      await writeFileAt(root, 'specs/d.txt', 'not markdown');
      await writeFileAt(root, 'insights.md', '# root insights');
      await writeFileAt(root, 'server/insights.md', '# server insights');
      await writeFileAt(root, 'clones/other-repo/specs/x.md', '# should never surface');
      await writeFileAt(root, 'node_modules/pkg/docs/y.md', '# should never surface either');

      // Symlink inside the clone pointing outside it (AC-3): lexically looks
      // like a normal discoverable doc, escapes only once resolved.
      const outside = path.join(base, 'outside-secret.md');
      await writeFile(outside, '# not part of this repo', 'utf8');
      await symlink(outside, path.join(root, 'specs', 'leak.md'));
    });

    afterAll(async () => {
      await rm(base, { recursive: true, force: true });
    });

    it('returns exactly the discoverable documents, typed correctly', async () => {
      const result = await scanDocuments(root, DEFAULT_OPTS);

      const byPath = new Map(result.documents.map((doc) => [doc.path, doc]));
      expect(new Set(result.documents.map((doc) => doc.path))).toEqual(
        new Set([
          'specs/a.md',
          'docs/nested/b.md',
          'pkg/insights/c.md',
          'insights.md',
          'server/insights.md',
        ]),
      );

      expect(byPath.get('specs/a.md')?.type).toBe('specs');
      expect(byPath.get('docs/nested/b.md')?.type).toBe('docs');
      expect(byPath.get('pkg/insights/c.md')?.type).toBe('insights');
      expect(byPath.get('insights.md')?.type).toBe('insights');
      expect(byPath.get('server/insights.md')?.type).toBe('insights');

      // size + hash are populated for every discovered document.
      for (const doc of result.documents) {
        expect(doc.size_bytes).toBeGreaterThan(0);
        expect(doc.content_hash).toMatch(/^[0-9a-f]{64}$/);
      }

      expect(result.omitted).toEqual({ by_count: 0, by_size: 0 });
    });

    it('drops the symlink that resolves outside the clone root', async () => {
      const result = await scanDocuments(root, DEFAULT_OPTS);
      expect(result.documents.some((doc) => doc.path === 'specs/leak.md')).toBe(false);
    });

    it('never surfaces anything under clones/ or node_modules/', async () => {
      const result = await scanDocuments(root, DEFAULT_OPTS);
      expect(result.documents.some((doc) => doc.path.startsWith('clones/'))).toBe(false);
      expect(result.documents.some((doc) => doc.path.startsWith('node_modules/'))).toBe(false);
    });
  });

  describe('AC-5 — caps and omission counters', () => {
    let root: string;

    beforeAll(async () => {
      root = await mkdtemp(path.join(tmpdir(), 'devdigest-project-context-caps-'));
      // 5 matching docs, cap at 2 -> 3 omitted by count.
      for (let i = 0; i < 5; i++) {
        await writeFileAt(root, `specs/doc-${i}.md`, `# doc ${i}`);
      }
      // One oversized file, cap at 10 bytes -> 1 omitted by size.
      await writeFileAt(root, 'specs/huge.md', 'x'.repeat(100));
    });

    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('caps document count and file size, reporting non-zero omission counters', async () => {
      const result = await scanDocuments(root, {
        roots: ['specs'],
        conventionalFilenames: [],
        maxDocs: 2,
        maxFileBytes: 10,
      });

      expect(result.documents.length).toBe(2);
      expect(result.omitted.by_count).toBeGreaterThan(0);
      expect(result.omitted.by_size).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('returns an empty result when the clone root does not exist', async () => {
      const result = await scanDocuments('/nonexistent/devdigest-clone-path', DEFAULT_OPTS);
      expect(result).toEqual({ documents: [], omitted: { by_count: 0, by_size: 0 } });
    });
  });
});
