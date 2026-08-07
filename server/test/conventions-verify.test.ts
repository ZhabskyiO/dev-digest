import { describe, it, expect } from 'vitest';
import type { ExtractedConvention } from '@devdigest/shared';
import {
  normalizeCode,
  normalizeRule,
  numberLines,
  verifyCandidates,
  verifyEvidence,
} from '../src/modules/conventions/helpers.js';

/**
 * The code-side evidence gate — the part of convention extraction that decides
 * what the model got away with. Every case here is a way a plausible-looking
 * proposal can be wrong without the model knowing it.
 */

const FILE_A = [
  'import { z } from "zod";',
  '',
  'export const UserSchema = z.object({',
  '  id: z.string().uuid(),',
  '});',
  '',
  'export function loadUser(id: string) {',
  '  return db.query(id);',
  '}',
];

const files = new Map<string, string[]>([['src/user.ts', FILE_A]]);

function proposal(over: Partial<ExtractedConvention> = {}): ExtractedConvention {
  return {
    category: 'typing',
    rule: 'Validate inputs with a zod schema.',
    evidence_path: 'src/user.ts',
    evidence_line: 3,
    evidence_snippet: 'export const UserSchema = z.object({',
    confidence: 0.9,
    ...over,
  };
}

describe('verifyEvidence', () => {
  it('accepts a snippet sitting on the cited line', () => {
    expect(verifyEvidence(files, proposal())).toEqual({
      line: 3,
      snippet: 'export const UserSchema = z.object({',
    });
  });

  it('drops a candidate citing a file that was never sampled', () => {
    expect(verifyEvidence(files, proposal({ evidence_path: 'src/invented.ts' }))).toBeNull();
  });

  it('corrects the line when the model is off by a few', () => {
    // Same real snippet, wrong line number — the citation should be repaired,
    // not thrown away, because the evidence itself is genuine.
    const verified = verifyEvidence(files, proposal({ evidence_line: 7 }));
    expect(verified).toEqual({ line: 3, snippet: 'export const UserSchema = z.object({' });
  });

  it('corrects an out-of-range line rather than crashing', () => {
    expect(verifyEvidence(files, proposal({ evidence_line: 999 }))?.line).toBe(3);
  });

  it('drops a snippet that occurs nowhere in the cited file', () => {
    expect(
      verifyEvidence(files, proposal({ evidence_snippet: 'export const Invented = 1;' })),
    ).toBeNull();
  });

  it('drops an empty snippet', () => {
    expect(verifyEvidence(files, proposal({ evidence_snippet: '   ' }))).toBeNull();
  });

  it('matches despite whitespace differences in the quote', () => {
    const verified = verifyEvidence(
      files,
      proposal({ evidence_line: 4, evidence_snippet: 'id:   z.string().uuid()' }),
    );
    expect(verified?.line).toBe(4);
  });
});

describe('verifyCandidates', () => {
  it('counts drops and keeps only grounded proposals', () => {
    const out = verifyCandidates(
      files,
      [
        proposal(),
        proposal({ rule: 'Ghost rule', evidence_path: 'src/nope.ts' }),
        proposal({ rule: 'Another ghost', evidence_snippet: 'nothing like this' }),
      ],
      new Set(),
    );
    expect(out.kept).toHaveLength(1);
    expect(out.dropped).toBe(2);
    expect(out.duplicates).toBe(0);
  });

  it('drops a proposal with an empty rule even when the evidence is real', () => {
    const out = verifyCandidates(files, [proposal({ rule: '   ' })], new Set());
    expect(out.kept).toEqual([]);
    expect(out.dropped).toBe(1);
  });

  it('treats a known rule key as a duplicate', () => {
    const known = new Set([normalizeRule('Validate inputs with a zod schema.')]);
    const out = verifyCandidates(files, [proposal()], known);
    expect(out.kept).toEqual([]);
    expect(out.duplicates).toBe(1);
  });

  it('does not resurrect a rule that differs only in punctuation or case', () => {
    // A rejected rule is a *known* rule; re-phrasing it must not slip past.
    const known = new Set([normalizeRule('Validate inputs with a zod schema.')]);
    const out = verifyCandidates(
      files,
      [proposal({ rule: 'VALIDATE inputs with a zod schema!!' })],
      known,
    );
    expect(out.duplicates).toBe(1);
    expect(out.kept).toEqual([]);
  });

  it('dedupes repeats within a single response', () => {
    const out = verifyCandidates(files, [proposal(), proposal()], new Set());
    expect(out.kept).toHaveLength(1);
    expect(out.duplicates).toBe(1);
  });

  it('clamps confidence into [0,1]', () => {
    const out = verifyCandidates(files, [proposal({ confidence: 4 })], new Set());
    expect(out.kept[0]?.confidence).toBe(1);
  });
});

describe('sample formatting', () => {
  it('numbers lines from 1 so a cited line maps back to the file', () => {
    const rendered = numberLines(FILE_A).split('\n');
    expect(rendered[0]).toBe('1\timport { z } from "zod";');
    expect(rendered[2]).toBe('3\texport const UserSchema = z.object({');
  });

  it('truncates to the line budget', () => {
    expect(numberLines(FILE_A, 2).split('\n')).toHaveLength(2);
  });

  it('normalizeCode collapses whitespace', () => {
    expect(normalizeCode('  a   b\t c ')).toBe('a b c');
  });
});
