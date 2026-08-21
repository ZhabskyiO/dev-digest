/**
 * `brief/evidence.ts` — the brief's ONE model call reads artifacts, never a
 * patch. These tests pin the two properties that make that true:
 *
 *  1. The rendered evidence is built from the intent, blast summary/symbols,
 *     grouped diff stats and finding titles — and a diff body has no way in
 *     (the input type has no `patch` field; the test proves the render never
 *     echoes one even when smuggled in through a structurally-typed object).
 *  2. It is BOUNDED: every cap saturated at once on a 20-file PR still stays
 *     under `BRIEF_EVIDENCE_MAX_CHARS` (~8k tokens with the template).
 *
 * Plus `selectFilesToSummarize` / `truncateSummary` (AC-35, AC-36, AC-40),
 * which had no unit test of their own.
 */
import { describe, it, expect } from 'vitest';
import type { BlastRadiusResult, BlastSymbol } from '@devdigest/shared';
import {
  renderBriefEvidence,
  groupedDiffStats,
  BRIEF_EVIDENCE_MAX_CHARS,
  MAX_SYMBOLS_PER_FILE,
  MAX_FINDINGS_PER_FILE,
  type BriefEvidenceInput,
  type FindingHint,
} from '../src/modules/reviews/brief/evidence.js';
import {
  selectFilesToSummarize,
  truncateSummary,
  MAX_SUMMARIZED_FILES,
} from '../src/modules/reviews/brief/summaries.js';

const file = (path: string, additions = 10, deletions = 2) => ({ path, additions, deletions });

function symbol(over: Partial<BlastSymbol> & { name: string; file: string }): BlastSymbol {
  return {
    kind: 'function',
    change: 'modified',
    callers: [],
    caller_count: 0,
    endpoints: [],
    crons: [],
    ...over,
  };
}

function blast(over: Partial<BlastRadiusResult> = {}): BlastRadiusResult {
  return {
    pull_id: 'pr1',
    status: 'ready',
    reason: null,
    degraded: false,
    indexed_sha: 'abc',
    changed_files: [],
    symbols: [],
    endpoints: [],
    crons: [],
    totals: { symbols: 0, added: 0, callers: 0, endpoints: 0, crons: 0 },
    prior_prs: [],
    summary: '2 changed symbols · 5 callers · 1 endpoint',
    ...over,
  };
}

const BASE: BriefEvidenceInput = {
  title: 'Retry declined charges with backoff',
  intent: {
    intent: 'Adds retry handling for failed card charges.',
    in_scope: ['payment retry', 'backoff configuration'],
    out_of_scope: ['refunds'],
    risk_areas: [],
  },
  intentIsCurrent: true,
  blast: blast({
    symbols: [
      symbol({ name: 'withBackoff', file: 'src/payments/charge.ts', change: 'added', caller_count: 1 }),
      symbol({
        name: 'chargeCard',
        file: 'src/payments/charge.ts',
        caller_count: 4,
        endpoints: [{ method: 'POST', path: '/api/orders', file: 'src/api/orders.ts' }],
      }),
    ],
  }),
  files: [
    file('src/payments/charge.ts', 30, 4),
    file('src/payments/config.ts', 3, 0),
    file('pnpm-lock.yaml', 400, 380),
  ],
  selected: [file('src/payments/charge.ts', 30, 4), file('src/payments/config.ts', 3, 0)],
  findings: new Map<string, FindingHint[]>([
    [
      'src/payments/charge.ts',
      [{ severity: 'medium', title: 'Retry loop has no upper bound on total wait time', line: 42 }],
    ],
  ]),
};

describe('renderBriefEvidence — artifacts in, never a patch', () => {
  it('renders title, intent + scope, blast summary, grouped diff stats in the context block', () => {
    const { context } = renderBriefEvidence(BASE);
    expect(context).toContain('title: Retry declined charges with backoff');
    expect(context).toContain('intent: Adds retry handling for failed card charges.');
    expect(context).toContain('in scope: payment retry; backoff configuration');
    expect(context).toContain('out of scope: refunds');
    expect(context).toContain('blast radius (ready): 2 changed symbols · 5 callers · 1 endpoint');
    // Grouped stats: the lockfile counts as boilerplate, never as a file to describe.
    expect(context).toContain('diff stats: 3 files changed, +433/-384: 1 core (+30/-4), 1 wiring (+3/-0), 1 boilerplate (+400/-380)');
    expect(context.startsWith('<untrusted source="pr">')).toBe(true);
  });

  it('renders one wrapped block per SELECTED file with role, churn, symbols and finding titles', () => {
    const { files } = renderBriefEvidence(BASE);
    expect(files).toContain('<untrusted source="file:1">\npath: src/payments/charge.ts');
    expect(files).toContain('role: core · +30/-4 · 1 finding');
    // `added` symbols come first — they are what the PR is about.
    expect(files).toContain(
      'changed symbols: withBackoff (function, added, 1 caller); chargeCard (function, modified, 4 callers, POST /api/orders)',
    );
    expect(files).toContain('findings: [medium] Retry loop has no upper bound on total wait time (line 42)');
    expect(files).toContain('<untrusted source="file:2">\npath: src/payments/config.ts');
    expect(files).toContain('role: wiring · +3/-0 · 0 findings');
    // The unselected lockfile never gets a block.
    expect(files).not.toContain('pnpm-lock.yaml');
    // The label is an index, never the (author-controlled) path.
    expect(files).not.toMatch(/source="file:src/);
  });

  it('never echoes a patch body, even when one is smuggled in on the file objects', () => {
    const PATCH = '@@ -1,3 +1,12 @@\n+const SMUGGLED_PATCH_LINE = 1;';
    const withPatch = {
      ...BASE,
      files: BASE.files.map((f) => ({ ...f, patch: PATCH })),
      selected: BASE.selected.map((f) => ({ ...f, patch: PATCH })),
    } satisfies BriefEvidenceInput;
    const { context, files } = renderBriefEvidence(withPatch);
    expect(context).not.toContain('SMUGGLED_PATCH_LINE');
    expect(files).not.toContain('SMUGGLED_PATCH_LINE');
    expect(files).not.toContain('@@ -1,3');
  });

  it('states a missing intent, a stale intent, and an unavailable/degraded blast plainly', () => {
    const noIntent = renderBriefEvidence({ ...BASE, intent: null, blast: null });
    expect(noIntent.context).toContain('intent: (not derived yet)');
    expect(noIntent.context).toContain('blast radius: (unavailable)');

    const stale = renderBriefEvidence({
      ...BASE,
      intentIsCurrent: false,
      blast: blast({ status: 'degraded', degraded: true, reason: 'Repository has not been indexed', summary: 'no indexed changes' }),
    });
    expect(stale.context).toContain('intent (derived at an earlier head commit): Adds retry handling');
    expect(stale.context).toContain('blast radius (degraded): no indexed changes — Repository has not been indexed');
  });

  it('caps symbols and findings per file and discloses the remainder', () => {
    const path = 'src/a.ts';
    const symbols = Array.from({ length: MAX_SYMBOLS_PER_FILE + 3 }, (_, i) =>
      symbol({ name: `sym${i}`, file: path, caller_count: i }),
    );
    const hints: FindingHint[] = Array.from({ length: MAX_FINDINGS_PER_FILE + 2 }, (_, i) => ({
      severity: i === 0 ? 'low' : 'high',
      title: `Finding ${i}`,
      line: i + 1,
    }));
    const { files } = renderBriefEvidence({
      ...BASE,
      blast: blast({ symbols }),
      files: [file(path)],
      selected: [file(path)],
      findings: new Map([[path, hints]]),
    });
    expect(files).toContain('… and 3 more');
    expect((files.match(/sym\d+ \(/g) ?? []).length).toBe(MAX_SYMBOLS_PER_FILE);
    // Highest severity first, so the lone `low` is what the cap drops.
    expect(files).toContain('… and 2 more');
    expect(files).not.toContain('Finding 0 (line 1)');
    expect((files.match(/\[high\]/g) ?? []).length).toBe(MAX_FINDINGS_PER_FILE);
  });

  it('stays under BRIEF_EVIDENCE_MAX_CHARS with EVERY cap saturated on a 20-file PR', () => {
    const long = (n: number, seed: string) => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);
    const paths = Array.from({ length: MAX_SUMMARIZED_FILES }, (_, i) => `${long(190, `src/very/deep/path-${i}/`)}${i}.ts`);
    const symbols = paths.flatMap((p) =>
      Array.from({ length: MAX_SYMBOLS_PER_FILE + 5 }, (_, i) =>
        symbol({
          name: long(80, `symbolName${i}`),
          file: p,
          kind: long(30, 'kindkind'),
          change: i % 2 ? 'added' : 'modified',
          caller_count: 99999,
          endpoints: [{ method: 'OPTIONS', path: long(120, '/api/very/long/endpoint/'), file: p }],
          crons: ['nightly'],
        }),
      ),
    );
    const findings = new Map(
      paths.map((p) => [
        p,
        Array.from({ length: MAX_FINDINGS_PER_FILE + 4 }, (_, i): FindingHint => ({
          severity: 'critical',
          title: long(300, `A very long finding title ${i} `),
          line: 99999,
        })),
      ]),
    );
    const input: BriefEvidenceInput = {
      title: long(1000, 'Title '),
      intent: {
        intent: long(5000, 'Intent sentence '),
        in_scope: Array.from({ length: 30 }, (_, i) => long(400, `scope item ${i} `)),
        out_of_scope: Array.from({ length: 30 }, (_, i) => long(400, `not in scope ${i} `)),
        risk_areas: [],
      },
      intentIsCurrent: false,
      blast: blast({ status: 'partial', reason: long(2000, 'reason '), summary: long(2000, 'summary '), symbols }),
      files: [...paths.map((p) => file(p, 99999, 99999)), ...Array.from({ length: 200 }, (_, i) => file(`gen/${i}.lock`, 9, 9))],
      selected: paths.map((p) => file(p, 99999, 99999)),
      findings,
    };
    const { context, files } = renderBriefEvidence(input);
    const total = context.length + files.length;
    expect(total).toBeLessThanOrEqual(BRIEF_EVIDENCE_MAX_CHARS);
    // And it is still all there — 20 blocks, one per selected file.
    expect((files.match(/<untrusted source="file:\d+">/g) ?? []).length).toBe(MAX_SUMMARIZED_FILES);
  });

  it('is deterministic — same input, same output', () => {
    expect(renderBriefEvidence(BASE)).toEqual(renderBriefEvidence(BASE));
  });
});

describe('groupedDiffStats', () => {
  it('counts files and lines per classifyPath bucket', () => {
    const stats = groupedDiffStats([
      file('src/payments/charge.ts', 10, 1),
      file('src/payments/charge.test.ts', 5, 5),
      file('package-lock.json', 100, 90),
      file('src/config/index.ts', 2, 0),
    ]);
    expect(stats.totalFiles).toBe(4);
    expect(stats.totalAdditions).toBe(117);
    expect(stats.totalDeletions).toBe(96);
    expect(stats.byRole.core.files).toBe(1);
    expect(stats.byRole.boilerplate.files).toBe(2);
    expect(stats.byRole.wiring.files).toBe(1);
  });
});

describe('selectFilesToSummarize', () => {
  it('AC-35: never selects boilerplate, however large its diff', () => {
    const out = selectFilesToSummarize(
      [file('package-lock.json', 9000, 9000), file('src/a.ts', 1, 0)],
      new Map(),
    );
    expect(out.map((c) => c.path)).toEqual(['src/a.ts']);
  });

  it('AC-36: caps at 20, ranked by finding count then churn, and keeps the highest-finding file', () => {
    const files = Array.from({ length: 40 }, (_, i) => file(`src/f${String(i).padStart(2, '0')}.ts`, i, 0));
    const out = selectFilesToSummarize(files, new Map([['src/f00.ts', 5]]));
    expect(out).toHaveLength(MAX_SUMMARIZED_FILES);
    expect(out[0]?.path).toBe('src/f00.ts');
    expect(out.some((c) => c.path === 'src/f39.ts')).toBe(true);
    expect(out.some((c) => c.path === 'src/f10.ts')).toBe(false);
  });
});

describe('truncateSummary', () => {
  it('AC-40: a 900-char reply is stored at exactly 200 chars ending in an ellipsis, on one line', () => {
    const out = truncateSummary('word\n'.repeat(180));
    expect(out).toHaveLength(200);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('\n');
  });
});
