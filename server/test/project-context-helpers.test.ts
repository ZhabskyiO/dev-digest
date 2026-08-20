/**
 * T9 — project-context pure helpers (`planBudget`, `mergeEffectiveSet`,
 * `outcomePrecedence`/`resolveOutcome`). No I/O, no DB — see helpers.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeEffectiveSet,
  outcomePrecedence,
  planBudget,
  resolveOutcome,
} from '../src/modules/project-context/helpers.js';

describe('planBudget', () => {
  it('injects everything when the whole set fits (AC-23/AC-40 happy path)', () => {
    const docs = [
      { path: 'a', tokens: 100 },
      { path: 'b', tokens: 200 },
    ];
    const result = planBudget(docs, 1000);
    expect(result.injected).toEqual(docs);
    expect(result.dropped).toEqual([]);
  });

  it('stops at the first document that overflows the budget, dropping it and everything after (AC-23, AC-40)', () => {
    // Second document alone exceeds the budget; a later, smaller document
    // must NOT be pulled in out of order.
    const docs = [
      { path: 'first', tokens: 100 },
      { path: 'second', tokens: 5000 },
      { path: 'third', tokens: 10 },
    ];
    const result = planBudget(docs, 1000);
    expect(result.injected).toEqual([{ path: 'first', tokens: 100 }]);
    expect(result.dropped).toEqual([
      { path: 'second', tokens: 5000 },
      { path: 'third', tokens: 10 },
    ]);
  });

  it('drops a document that exactly meets the boundary as injected, not dropped', () => {
    const docs = [{ path: 'a', tokens: 500 }];
    const result = planBudget(docs, 500);
    expect(result.injected).toEqual(docs);
    expect(result.dropped).toEqual([]);
  });

  it('handles an empty document list', () => {
    expect(planBudget([], 1000)).toEqual({ injected: [], dropped: [] });
  });
});

describe('mergeEffectiveSet', () => {
  it('agent-first, de-duped by (repo_id, path), keeping the first occurrence (AC-16)', () => {
    const own = [{ repo_id: 'r1', path: 'specs/security-baseline.md', tag: 'own' }];
    const skill = [
      { repo_id: 'r1', path: 'specs/security-baseline.md', tag: 'skill' },
      { repo_id: 'r1', path: 'specs/public-api.md', tag: 'skill' },
    ];

    const merged = mergeEffectiveSet(own, skill);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ repo_id: 'r1', path: 'specs/security-baseline.md', tag: 'own' });
    expect(merged[1]).toEqual({ repo_id: 'r1', path: 'specs/public-api.md', tag: 'skill' });
  });

  it('disabling the contributing skill (an empty skillAttachments list) drops its documents', () => {
    const own = [{ repo_id: 'r1', path: 'specs/security-baseline.md' }];
    const merged = mergeEffectiveSet(own, []);
    expect(merged).toEqual(own);
  });

  it('de-dupes across two different repos independently (repo_id is part of the key)', () => {
    const own = [{ repo_id: 'r1', path: 'docs/a.md' }];
    const skill = [{ repo_id: 'r2', path: 'docs/a.md' }];
    const merged = mergeEffectiveSet(own, skill);
    expect(merged).toEqual([...own, ...skill]);
  });
});

describe('outcomePrecedence / resolveOutcome', () => {
  it('exposes the documented precedence order', () => {
    expect(outcomePrecedence()).toEqual([
      'missing',
      'wrong_repo',
      'dropped_over_budget',
      'changed_unconfirmed',
      'truncated',
      'injected',
    ]);
  });

  it('picks the higher-precedence outcome when a document is both truncated and changed-unconfirmed (AC-24 + AC-44)', () => {
    expect(resolveOutcome(['truncated', 'changed_unconfirmed'])).toBe('changed_unconfirmed');
  });

  it('a document that never reached the model outranks one that did', () => {
    expect(resolveOutcome(['injected', 'dropped_over_budget'])).toBe('dropped_over_budget');
    expect(resolveOutcome(['truncated', 'missing'])).toBe('missing');
  });

  it('defaults to injected for an empty candidate set', () => {
    expect(resolveOutcome([])).toBe('injected');
  });
});
