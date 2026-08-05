import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  deriveSkillName,
  extractSkillFromArchive,
  isConfigChange,
  isDisallowedIp,
  parseFrontmatter,
  toSkillDto,
  toSkillVersionDto,
} from '../src/modules/skills/helpers.js';
import { MAX_ARCHIVE_ENTRIES } from '../src/modules/skills/constants.js';
import type { SkillRow, SkillVersionRow } from '../src/db/rows.js';

/**
 * Unit coverage for the skills module's pure helpers — frontmatter parsing,
 * name derivation, in-memory archive extraction (incl. the zip-bomb guard),
 * row → DTO mapping, and the config-version-bump rule.
 */

describe('parseFrontmatter', () => {
  it('parses a well-formed frontmatter block', () => {
    const md = [
      '---',
      'name: My Skill',
      'description: Does things',
      'type: rubric',
      '---',
      '',
      '# Body',
    ].join('\n');

    expect(parseFrontmatter(md)).toEqual({
      name: 'My Skill',
      description: 'Does things',
      type: 'rubric',
    });
  });

  it('returns an empty object without throwing when frontmatter is missing', () => {
    expect(parseFrontmatter('# Just a heading\n\nSome body text.')).toEqual({});
  });

  it('returns an empty object without throwing when the frontmatter block is malformed (no closing ---)', () => {
    const md = ['---', 'name: Unclosed', '', '# Body'].join('\n');
    expect(parseFrontmatter(md)).toEqual({});
  });

  it('ignores unknown extra keys', () => {
    const md = ['---', 'name: My Skill', 'foo: bar', 'unknown_key: whatever', '---', 'body'].join(
      '\n',
    );
    const result = parseFrontmatter(md);
    expect(result).toEqual({ name: 'My Skill' });
    expect(result).not.toHaveProperty('foo');
    expect(result).not.toHaveProperty('unknown_key');
  });

  it('strips quotes from quoted values (double and single)', () => {
    const md = ['---', 'name: "Quoted Name"', "description: 'Single quoted'", '---', 'body'].join(
      '\n',
    );
    expect(parseFrontmatter(md)).toEqual({
      name: 'Quoted Name',
      description: 'Single quoted',
    });
  });
});

describe('deriveSkillName', () => {
  it('prefers the frontmatter name when present', () => {
    const md = ['---', 'name: Frontmatter Name', '---', '# Heading Name', 'body'].join('\n');
    expect(deriveSkillName(md)).toBe('Frontmatter Name');
  });

  it('falls back to the first hash-heading when there is no frontmatter name', () => {
    const md = ['Some intro text.', '# First Heading', '# Second Heading'].join('\n');
    expect(deriveSkillName(md)).toBe('First Heading');
  });

  it("falls back to 'Untitled skill' when neither frontmatter name nor a heading exists", () => {
    expect(deriveSkillName('Just a paragraph of text, no heading at all.')).toBe('Untitled skill');
  });
});

describe('extractSkillFromArchive', () => {
  it('finds SKILL.md at the root, and puts an unrelated script in skipped', () => {
    const zip = zipSync({
      'SKILL.md': strToU8('# Root Skill\nBody text.'),
      'scripts/evil.sh': strToU8('#!/bin/sh\necho pwned'),
    });

    const result = extractSkillFromArchive(zip);
    expect(result.body).toBe('# Root Skill\nBody text.');
    expect(result.skipped).toContain('scripts/evil.sh');
    expect(result.skipped).not.toContain('SKILL.md');
  });

  it('finds SKILL.md nested two directories deep (any-depth rule), readme.md goes to skipped', () => {
    const zip = zipSync({
      'readme.md': strToU8('# Top-level readme'),
      'a/b/SKILL.md': strToU8('# Nested Skill\nNested body.'),
    });

    const result = extractSkillFromArchive(zip);
    expect(result.body).toBe('# Nested Skill\nNested body.');
    expect(result.skipped).toContain('readme.md');
    expect(result.skipped).not.toContain('a/b/SKILL.md');
  });

  it('uses the single .md file present when there is no SKILL.md at all', () => {
    const zip = zipSync({
      'docs/notes.md': strToU8('# Only Markdown File\nContent.'),
      'assets/logo.png': strToU8('not really a png'),
    });

    const result = extractSkillFromArchive(zip);
    expect(result.body).toBe('# Only Markdown File\nContent.');
    expect(result.skipped).toContain('assets/logo.png');
    expect(result.skipped).not.toContain('docs/notes.md');
  });

  it('throws when the archive has more entries than MAX_ARCHIVE_ENTRIES', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ARCHIVE_ENTRIES; i++) {
      files[`file-${i}.md`] = strToU8('x');
    }
    const zip = zipSync(files);

    expect(() => extractSkillFromArchive(zip)).toThrow();
  });
});

describe('toSkillDto', () => {
  const baseRow: SkillRow = {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'Rubric Skill',
    description: 'A description',
    type: 'rubric',
    source: 'manual',
    body: '# Body',
    enabled: true,
    version: 3,
    evidenceFiles: ['a.ts', 'b.ts'],
    createdAt: new Date('2026-01-01T00:00:00Z'),
  } as SkillRow;

  it('maps a row to the correct DTO shape', () => {
    expect(toSkillDto(baseRow)).toEqual({
      id: 'skill-1',
      name: 'Rubric Skill',
      description: 'A description',
      type: 'rubric',
      source: 'manual',
      body: '# Body',
      enabled: true,
      version: 3,
      evidence_files: ['a.ts', 'b.ts'],
    });
  });

  it('maps a null evidenceFiles to a null evidence_files', () => {
    const row = { ...baseRow, evidenceFiles: null } as SkillRow;
    expect(toSkillDto(row).evidence_files).toBeNull();
  });
});

describe('toSkillVersionDto', () => {
  it('maps a skill_versions row to the correct DTO shape', () => {
    const row: SkillVersionRow = {
      skillId: 'skill-1',
      version: 2,
      body: '# Version 2 body',
      createdAt: new Date('2026-02-02T12:00:00Z'),
    } as SkillVersionRow;

    expect(toSkillVersionDto(row)).toEqual({
      skill_id: 'skill-1',
      version: 2,
      body: '# Version 2 body',
      created_at: '2026-02-02T12:00:00.000Z',
    });
  });
});

describe('isConfigChange', () => {
  const existing = { body: '# Original body' };

  it('returns true when the patch changes body', () => {
    expect(isConfigChange(existing, { body: '# New body' })).toBe(true);
  });

  it('returns false when the patch touches only other fields (body absent)', () => {
    expect(isConfigChange(existing, {})).toBe(false);
  });

  it('returns false when the patch sets body to the same value as existing', () => {
    expect(isConfigChange(existing, { body: '# Original body' })).toBe(false);
  });
});

describe('isDisallowedIp', () => {
  it('blocks IPv4 loopback', () => {
    expect(isDisallowedIp('127.0.0.1')).toBe(true);
  });

  it('blocks the RFC1918 private ranges', () => {
    expect(isDisallowedIp('10.1.2.3')).toBe(true);
    expect(isDisallowedIp('172.16.0.5')).toBe(true);
    expect(isDisallowedIp('172.31.255.255')).toBe(true);
    expect(isDisallowedIp('192.168.1.1')).toBe(true);
  });

  it('blocks link-local, including the cloud metadata address', () => {
    expect(isDisallowedIp('169.254.169.254')).toBe(true);
  });

  it('does not block a routable public IPv4 address', () => {
    expect(isDisallowedIp('93.184.216.34')).toBe(false);
    // 172.15.x and 172.32.x are outside the 172.16/12 private block.
    expect(isDisallowedIp('172.15.0.1')).toBe(false);
    expect(isDisallowedIp('172.32.0.1')).toBe(false);
  });

  it('blocks IPv6 loopback, link-local, and unique-local', () => {
    expect(isDisallowedIp('::1')).toBe(true);
    expect(isDisallowedIp('fe80::1')).toBe(true);
    expect(isDisallowedIp('fd00::1')).toBe(true);
  });

  it('unwraps an IPv4-mapped IPv6 loopback and blocks it too', () => {
    expect(isDisallowedIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('does not block a routable public IPv6 address', () => {
    expect(isDisallowedIp('2001:4860:4860::8888')).toBe(false);
  });
});
