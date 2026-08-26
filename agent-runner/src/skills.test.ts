import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSkillBodies } from './skills.js';
import { RunnerError } from './errors.js';

/**
 * `manifest.skills` is untrusted, on-disk content validated only as
 * `string[]` by the shared `AgentManifest` schema — no format constraint on
 * each slug. These tests guard the traversal fix in `loadSkillBodies`: a
 * malicious/malformed slug must never escape `<devdigestDir>/skills/`.
 */
describe('loadSkillBodies — slug validation (traversal fix)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-skills-'));
    mkdirSync(path.join(dir, 'skills'), { recursive: true });
    writeFileSync(path.join(dir, 'skills', 'security-basics.md'), '# Security basics\n');
    // A file OUTSIDE the skills/ dir that a traversal slug would try to read.
    writeFileSync(path.join(dir, 'secret.md'), 'TOP SECRET\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a well-formed slug normally', () => {
    const [body] = loadSkillBodies(dir, ['security-basics']);
    expect(body).toContain('Security basics');
  });

  it('rejects a `../` traversal slug before ever touching the filesystem', () => {
    expect(() => loadSkillBodies(dir, ['../secret'])).toThrow(RunnerError);
    expect(() => loadSkillBodies(dir, ['../secret'])).toThrow(/Invalid skill slug/i);
  });

  it('rejects a deep traversal slug reaching outside the repo entirely', () => {
    expect(() => loadSkillBodies(dir, ['../../../../../../etc/passwd'])).toThrow(RunnerError);
  });

  it('rejects an absolute-path-shaped slug', () => {
    expect(() => loadSkillBodies(dir, ['/etc/passwd'])).toThrow(RunnerError);
  });

  it('rejects a slug containing a forward slash even without `..`', () => {
    expect(() => loadSkillBodies(dir, ['sub/other'])).toThrow(RunnerError);
  });
});
