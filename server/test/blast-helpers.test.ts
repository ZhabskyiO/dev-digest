import { describe, it, expect } from 'vitest';
import { BlastRadiusResult } from '@devdigest/shared';
import {
  parseEndpoint,
  buildStatus,
  buildSummary,
  toBlastDto,
  changedLineRanges,
} from '../src/modules/blast/helpers.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import { symbolKey } from '../src/modules/repo-intel/types.js';

const K = symbolKey;

/**
 * Blast DTO mapping — pure, no DB, no clone.
 *
 * The property under test throughout: the response must never present missing
 * data as absent impact. Truncated caller lists carry their true count, and an
 * unusable index produces `degraded` + a reason rather than empty arrays.
 */

const readyState: IndexState = {
  repoId: 'r1',
  lastIndexedSha: 'abc',
  indexerVersion: 2,
  status: 'full',
  filesIndexed: 10,
  filesSkipped: 0,
  durationMs: 5,
  updatedAt: new Date(0),
};

function blast(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    callerTotals: {},
    degraded: false,
    ...over,
  };
}

describe('parseEndpoint', () => {
  it('splits the index\'s flat "METHOD /path" fact', () => {
    expect(parseEndpoint('GET /api/public/items', 'src/api/index.ts')).toEqual({
      method: 'GET',
      path: '/api/public/items',
      file: 'src/api/index.ts',
    });
  });

  it('splits on the FIRST space only, so a path is never truncated', () => {
    expect(parseEndpoint('POST /a/b c', 'f.ts').path).toBe('/a/b c');
  });

  it('keeps an unsplittable fact whole rather than dropping it', () => {
    expect(parseEndpoint('/no-verb', 'f.ts')).toEqual({
      method: '',
      path: '/no-verb',
      file: 'f.ts',
    });
  });
});

describe('buildStatus', () => {
  it('full index + non-degraded blast → ready, no reason', () => {
    expect(buildStatus(readyState, blast())).toEqual({ status: 'ready', reason: null });
  });

  it('partial index → partial, and the reason names the skipped files', () => {
    const res = buildStatus({ ...readyState, status: 'partial', filesSkipped: 42 }, blast());
    expect(res.status).toBe('partial');
    expect(res.reason).toContain('42');
  });

  it('a clipped downstream walk is partial even on a full index', () => {
    const res = buildStatus(readyState, blast({ frontierClipped: true }));
    expect(res.status).toBe('partial');
    expect(res.reason).toContain('file budget');
  });

  it('degraded blast → degraded with an actionable reason', () => {
    const res = buildStatus(readyState, blast({ degraded: true, reason: 'no_data' }));
    expect(res.status).toBe('degraded');
    expect(res.reason).toMatch(/not been indexed/i);
  });

  it('flag_off is reported as the flag, not as "no data"', () => {
    const state: IndexState = {
      ...readyState,
      status: 'degraded',
      degraded: true,
      degradedReason: 'flag_off',
    };
    expect(buildStatus(state, blast({ degraded: true })).reason).toMatch(/REPO_INTEL_ENABLED/);
  });
});

describe('buildSummary', () => {
  it('is deterministic and counts what is there', () => {
    const totals = { symbols: 2, callers: 14, endpoints: 3, crons: 1 };
    expect(buildSummary(totals, 'ready')).toBe(
      '2 changed symbols · 14 callers · 3 endpoints · 1 cron/job',
    );
  });

  it('singularizes and omits empty buckets', () => {
    expect(buildSummary({ symbols: 1, callers: 1, endpoints: 0, crons: 0 }, 'ready')).toBe(
      '1 changed symbol · 1 caller',
    );
  });

  it('distinguishes "nothing found" from "we could not look"', () => {
    const none = { symbols: 0, callers: 0, endpoints: 0, crons: 0 };
    expect(buildSummary(none, 'ready')).toMatch(/No indexed symbols/);
    expect(buildSummary(none, 'degraded')).toMatch(/not indexed/);
  });
});

describe('toBlastDto', () => {
  const base = {
    pullId: 'p1',
    // matches readyState.lastIndexedSha, so staleness doesn't mask these cases
    headSha: 'abc',
    changedFiles: ['src/limit.ts'],
    indexState: readyState,
    priorPrs: [],
  };

  it('groups callers under the symbol they reach and parses out endpoints', () => {
    const dto = toBlastDto({
      ...base,
      blast: blast({
        changedSymbols: [{ file: 'src/limit.ts', name: 'rateLimit', kind: 'function' }],
        callers: [
          { file: 'src/api/index.ts', symbol: 'publicRouter', viaSymbol: 'rateLimit', viaFile: 'src/limit.ts', line: 23, rank: 0.9 },
          { file: 'src/server.ts', symbol: 'boot', viaSymbol: 'rateLimit', viaFile: 'src/limit.ts', line: 88, rank: 0.4 },
        ],
        callerTotals: { [K('src/limit.ts', 'rateLimit')]: 2 },
        impactedEndpoints: ['GET /api/public/items'],
        endpointsBySymbol: { [K('src/limit.ts', 'rateLimit')]: ['GET /api/public/items'] },
        cronsBySymbol: { [K('src/limit.ts', 'rateLimit')]: ['reset-rate-buckets (hourly)'] },
        factsByFile: {
          'src/api/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
        },
      }),
    });

    expect(BlastRadiusResult.parse(dto)).toBeTruthy();
    expect(dto.status).toBe('ready');
    expect(dto.symbols).toHaveLength(1);
    expect(dto.symbols[0]?.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/api/index.ts:23',
      'src/server.ts:88',
    ]);
    // the endpoint is attributed back to the file that registers it
    expect(dto.symbols[0]?.endpoints).toEqual([
      { method: 'GET', path: '/api/public/items', file: 'src/api/index.ts' },
    ]);
    expect(dto.symbols[0]?.crons).toEqual(['reset-rate-buckets (hourly)']);
    expect(dto.totals).toEqual({ symbols: 1, callers: 2, endpoints: 1, crons: 1 });
  });

  it('reports the PRE-CAP caller total, so a truncated list is not read as the whole story', () => {
    const dto = toBlastDto({
      ...base,
      blast: blast({
        changedSymbols: [{ file: 'src/limit.ts', name: 'rateLimit', kind: 'function' }],
        // the facade already capped this at 20; the total says there were 63
        callers: Array.from({ length: 20 }, (_, i) => ({
          file: `src/c${i}.ts`,
          symbol: `c${i}`,
          viaSymbol: 'rateLimit',
          viaFile: 'src/limit.ts',
          line: i + 1,
          rank: 1 - i / 100,
        })),
        callerTotals: { [K('src/limit.ts', 'rateLimit')]: 63 },
      }),
    });
    expect(dto.symbols[0]?.callers).toHaveLength(20);
    expect(dto.symbols[0]?.caller_count).toBe(63);
    expect(dto.totals.callers).toBe(63);
  });

  it('orders symbols by reach, widest first', () => {
    const dto = toBlastDto({
      ...base,
      blast: blast({
        changedSymbols: [
          { file: 'src/limit.ts', name: 'bucketKey', kind: 'function' },
          { file: 'src/limit.ts', name: 'rateLimit', kind: 'function' },
        ],
        callerTotals: {
          [K('src/limit.ts', 'bucketKey')]: 2,
          [K('src/limit.ts', 'rateLimit')]: 4,
        },
      }),
    });
    expect(dto.symbols.map((s) => s.name)).toEqual(['rateLimit', 'bucketKey']);
  });

  it('a degraded index yields degraded + reason, NOT a clean empty result', () => {
    const dto = toBlastDto({
      ...base,
      blast: blast({ degraded: true, reason: 'no_data' }),
      indexState: { ...readyState, status: 'degraded', degraded: true, degradedReason: 'index_failed' },
    });
    expect(dto.status).toBe('degraded');
    expect(dto.degraded).toBe(true);
    expect(dto.reason).not.toBeNull();
    expect(BlastRadiusResult.parse(dto)).toBeTruthy();
  });
});

describe('changedLineRanges', () => {
  it('reads the BASE side of every hunk header', () => {
    const patch = [
      '@@ -12,5 +12,7 @@ export function a() {',
      ' ctx',
      '@@ -100,3 +102,3 @@',
      ' ctx',
    ].join('\n');
    expect(changedLineRanges(patch)).toEqual([
      { start: 12, end: 16 },
      { start: 100, end: 102 },
    ]);
  });

  it('treats a countless header as a single line', () => {
    expect(changedLineRanges('@@ -12 +12 @@')).toEqual([{ start: 12, end: 12 }]);
  });

  it('keeps a pure insertion (count 0) as its insertion point', () => {
    expect(changedLineRanges('@@ -40,0 +41,9 @@')).toEqual([{ start: 40, end: 40 }]);
  });

  it('returns [] for a missing patch rather than throwing', () => {
    expect(changedLineRanges(null)).toEqual([]);
  });
});

describe('buildStatus — index/head staleness', () => {
  it('is partial when the PR head is not the indexed revision', () => {
    // The index is built from the default branch, so a PR branch is never in
    // it: reporting `ready` would hide exactly the code under review.
    const res = buildStatus(readyState, blast(), 'deadbeefcafe');
    expect(res.status).toBe('partial');
    expect(res.reason).toMatch(/symbols this PR ADDS are not indexed/);
    expect(res.reason).toContain('abc');
    expect(res.reason).toContain('deadbee');
  });

  it('stays ready when the head IS the indexed revision', () => {
    expect(buildStatus(readyState, blast(), 'abc').status).toBe('ready');
  });

  it('ignores a null head sha', () => {
    expect(buildStatus(readyState, blast(), null).status).toBe('ready');
  });
});

describe('toBlastDto — same name in two files', () => {
  it('does NOT merge callers of same-named symbols declared in different files', () => {
    const dto = toBlastDto({
      pullId: 'p1',
      headSha: 'abc',
      changedFiles: ['src/a/repo.ts', 'src/a/service.ts'],
      indexState: readyState,
      priorPrs: [],
      blast: blast({
        changedSymbols: [
          { file: 'src/a/repo.ts', name: 'getById', kind: 'method' },
          { file: 'src/a/service.ts', name: 'getById', kind: 'method' },
        ],
        callers: [
          { file: 'src/a/service.ts', symbol: 'svc', viaSymbol: 'getById', viaFile: 'src/a/repo.ts', line: 10, rank: 0.9 },
          { file: 'src/a/routes.ts', symbol: 'routes', viaSymbol: 'getById', viaFile: 'src/a/service.ts', line: 20, rank: 0.8 },
        ],
        callerTotals: {
          [K('src/a/repo.ts', 'getById')]: 1,
          [K('src/a/service.ts', 'getById')]: 1,
        },
      }),
    });

    const repo = dto.symbols.find((s) => s.file === 'src/a/repo.ts');
    const service = dto.symbols.find((s) => s.file === 'src/a/service.ts');
    expect(repo?.callers.map((c) => c.file)).toEqual(['src/a/service.ts']);
    expect(service?.callers.map((c) => c.file)).toEqual(['src/a/routes.ts']);
    // and the total is 2, not 4 — keying on the bare name double-counted both
    expect(dto.totals.callers).toBe(2);
  });
});
