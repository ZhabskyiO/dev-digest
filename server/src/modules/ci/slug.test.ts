import { describe, expect, it } from 'vitest';
import { InvalidSlugError, toSlug, toUniqueSlugs } from './slug.js';

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

describe('toSlug', () => {
  it('lowercases and keeps an already-safe name unchanged in shape', () => {
    expect(toSlug('My Skill')).toBe('my-skill');
    expect(SAFE_SLUG.test(toSlug('My Skill'))).toBe(true);
  });

  it('normalises a hostile path-traversal name rather than escaping (AC-17)', () => {
    const slug = toSlug('../../etc/passwd');
    expect(SAFE_SLUG.test(slug)).toBe(true);
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('..');
  });

  it('collapses runs of unsafe characters to a single hyphen', () => {
    expect(toSlug('a!!!b')).toBe('a-b');
    expect(toSlug('a   b')).toBe('a-b');
  });

  it('trims leading and trailing hyphens produced by unsafe edges', () => {
    expect(toSlug('!!!hello!!!')).toBe('hello');
  });

  it('throws InvalidSlugError when nothing safe survives normalisation', () => {
    expect(() => toSlug('!!!')).toThrow(InvalidSlugError);
    expect(() => toSlug('...')).toThrow(InvalidSlugError);
    expect(() => toSlug('   ')).toThrow(InvalidSlugError);
  });
});

describe('toUniqueSlugs', () => {
  it('deduplicates colliding slugs deterministically ordered by input order', () => {
    const slugs = toUniqueSlugs(['Security', 'security', 'SECURITY']);
    expect(slugs).toEqual(['security', 'security-2', 'security-3']);
  });

  it('produces the same output across repeated calls (determinism)', () => {
    const names = ['Security', 'Style Guide', 'security'];
    expect(toUniqueSlugs(names)).toEqual(toUniqueSlugs(names));
  });

  it('never collides a dedup suffix with a literal slug already in the input', () => {
    const slugs = toUniqueSlugs(['a', 'a', 'a-2']);
    expect(slugs).toEqual(['a', 'a-2', 'a-2-2']);
    expect(new Set(slugs).size).toBe(3);
  });

  it('every produced slug matches the runner-accepted shape', () => {
    const slugs = toUniqueSlugs(['My Skill', 'My Skill', '../../etc/passwd']);
    for (const slug of slugs) {
      expect(SAFE_SLUG.test(slug)).toBe(true);
    }
  });
});
