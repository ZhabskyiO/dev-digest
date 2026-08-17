import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import { symbolKey } from '../src/modules/repo-intel/types.js';

/**
 * The persistent blast path: per-symbol caller capping and the depth-2 reverse
 * import walk. No Postgres — the repository is stubbed with a hand-built index
 * so the graph shape under test is obvious.
 */

type Edge = { fromFile: string; toFile: string };

function buildService(index: {
  symbols: { path: string; name: string; kind: string; line: number }[];
  callers: { fromPath: string; toSymbol: string; declFile: string; line: number; rank: number }[];
  edges: Edge[];
  facts: Record<string, { endpoints: string[]; crons: string[] }>;
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: 'full' }),
    getSymbolRows: async (_r: string, paths: string[]) =>
      index.symbols
        .filter((s) => paths.includes(s.path))
        .map((s) => ({ ...s, endLine: s.line, exported: true, signature: null })),
    getResolvedCallers: async (_r: string, declFiles: string[], names: string[]) =>
      index.callers.filter((c) => names.includes(c.toSymbol) && declFiles.length > 0),
    getImporters: async (_r: string, toFiles: string[]) =>
      index.edges.filter((e) => toFiles.includes(e.toFile)),
    getFileFacts: async (_r: string, files: string[]) =>
      files
        .filter((f) => index.facts[f])
        .map((f) => ({ filePath: f, ...index.facts[f]! })),
  };
  return svc;
}

describe('getBlastRadius — caller capping', () => {
  it('caps at MAX_CALLERS_PER_SYMBOL PER SYMBOL, not across the whole result', async () => {
    // Two changed symbols, each with more callers than the cap. Capping the
    // flat rank-sorted list would give `hot` all 20 slots and render `cold` as
    // having no callers at all — i.e. "safe to change", which is false.
    const callers = [
      ...Array.from({ length: 30 }, (_, i) => ({
        fromPath: `src/hot${i}.ts`,
        toSymbol: 'hot',
        declFile: 'src/a.ts',
        line: i + 1,
        rank: 0.9,
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        fromPath: `src/cold${i}.ts`,
        toSymbol: 'cold',
        declFile: 'src/a.ts',
        line: i + 1,
        rank: 0.1,
      })),
    ];
    const svc = buildService({
      symbols: [
        { path: 'src/a.ts', name: 'hot', kind: 'function', line: 1 },
        { path: 'src/a.ts', name: 'cold', kind: 'function', line: 50 },
      ],
      callers,
      edges: [],
      facts: {},
    });

    const res = await svc.getBlastRadius('r1', ['src/a.ts']);

    const byVia = (n: string) => res.callers.filter((c) => c.viaSymbol === n);
    expect(byVia('hot')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(byVia('cold')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // and the pre-cap totals are preserved so nothing looks smaller than it is
    expect(res.callerTotals[symbolKey('src/a.ts', 'hot')]).toBe(30);
    expect(res.callerTotals[symbolKey('src/a.ts', 'cold')]).toBe(30);
  });
});

describe('getBlastRadius — downstream endpoint walk', () => {
  // A imports nothing; B imports A; C imports B; D imports C.
  // Only C and D register endpoints. Changing A must reach C (2 hops) but not D.
  const edges: Edge[] = [
    { fromFile: 'src/b.ts', toFile: 'src/a.ts' },
    { fromFile: 'src/c.ts', toFile: 'src/b.ts' },
    { fromFile: 'src/d.ts', toFile: 'src/c.ts' },
  ];
  const facts = {
    'src/c.ts': { endpoints: ['GET /two-hops'], crons: [] },
    'src/d.ts': { endpoints: ['GET /three-hops'], crons: ['nightly'] },
  };

  it('reaches an endpoint two modules downstream of the changed file', async () => {
    const svc = buildService({
      symbols: [{ path: 'src/a.ts', name: 'helper', kind: 'function', line: 1 }],
      callers: [],
      edges,
      facts,
    });

    const res = await svc.getBlastRadius('r1', ['src/a.ts']);

    expect(res.degraded).toBe(false);
    expect(res.impactedEndpoints).toContain('GET /two-hops');
    expect(res.endpointsBySymbol?.[symbolKey('src/a.ts', 'helper')]).toContain('GET /two-hops');
  });

  it('stops at BFS_DEPTH — a three-hop endpoint is not claimed', async () => {
    const svc = buildService({
      symbols: [{ path: 'src/a.ts', name: 'helper', kind: 'function', line: 1 }],
      callers: [],
      edges,
      facts,
    });

    const res = await svc.getBlastRadius('r1', ['src/a.ts']);

    expect(res.impactedEndpoints).not.toContain('GET /three-hops');
    expect(res.cronsBySymbol?.[symbolKey('src/a.ts', 'helper')] ?? []).not.toContain('nightly');
  });

  it('attributes crons to the symbol that reaches them', async () => {
    const svc = buildService({
      symbols: [{ path: 'src/c.ts', name: 'handler', kind: 'function', line: 1 }],
      callers: [],
      edges,
      facts,
    });

    const res = await svc.getBlastRadius('r1', ['src/c.ts']);

    // d.ts is one hop downstream of c.ts
    expect(res.cronsBySymbol?.[symbolKey('src/c.ts', 'handler')]).toContain('nightly');
  });
});
