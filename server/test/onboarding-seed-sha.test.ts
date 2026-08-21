/**
 * Regression guard for the pre-PR gate finding: `seed.ts`'s demo onboarding
 * tour shipped a 39-hex-char `indexed_revision` (one short of a real sha),
 * which can never equal `repo_index_state.lastIndexedSha` and so rendered
 * the seeded tour permanently `stale` (`OnboardingService.getTour`,
 * `service.ts:138`). `seed()` itself requires a live `Db` and isn't invoked
 * hermetically here — instead this reads the literal straight out of the
 * source, which is exactly what the finding asked for ("verify the length
 * programmatically rather than by eye") and fails loudly if the literal
 * regresses to a malformed sha again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const seedSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db/seed.ts'),
  'utf-8',
);

describe('seed.ts onboarding indexed_revision', () => {
  it('is a well-formed 40-char lowercase hex sha', () => {
    const match = seedSource.match(/indexed_revision:\s*'([^']+)'/);
    expect(match, 'expected to find an indexed_revision literal in seed.ts').not.toBeNull();

    const sha = match![1]!;
    expect(sha.length).toBe(40);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('carries a runtime check that throws on a malformed indexed_revision, not just an eyeballed literal', () => {
    // Guards against the fix regressing to "correct today, unchecked
    // tomorrow" — the seed itself must assert the shape, not just this test.
    expect(seedSource).toMatch(/\/\^\[0-9a-f\]\{40\}\$\/\.test\(onboardingPayload\.indexed_revision\)/);
  });
});
