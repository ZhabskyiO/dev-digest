import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, classifyPath } from '../src/modules/reviews/smart-diff/index.js';
import { findingsFromLatestRunPerAgent } from '../src/modules/reviews/helpers.js';
import {
  SPLIT_MIN_FILES,
  SPLIT_TOO_BIG_LINES,
  SPLIT_GENERATED_BUCKET,
} from '../src/modules/reviews/smart-diff/constants.js';

const file = (path: string, additions = 10, deletions = 0) => ({ path, additions, deletions });

describe('classifyPath', () => {
  it('ALWAYS classifies a lockfile as boilerplate, at any depth', () => {
    // The acceptance criterion, asserted directly rather than through the UI.
    for (const path of [
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lockb',
      'Cargo.lock',
      'go.sum',
      'poetry.lock',
      'Gemfile.lock',
      'composer.lock',
      'packages/web/package-lock.json',
      'server/pnpm-lock.yaml',
    ]) {
      expect(classifyPath(path), path).toBe('boilerplate');
    }
  });

  it('classifies generated output, snapshots, and tests as boilerplate', () => {
    expect(classifyPath('dist/bundle.js')).toBe('boilerplate');
    expect(classifyPath('client/.next/static/chunk.js')).toBe('boilerplate');
    expect(classifyPath('coverage/lcov.info')).toBe('boilerplate');
    expect(classifyPath('src/__snapshots__/Card.tsx.snap')).toBe('boilerplate');
    expect(classifyPath('src/api.min.js')).toBe('boilerplate');
    expect(classifyPath('src/schema.generated.ts')).toBe('boilerplate');
    expect(classifyPath('api/user.pb.go')).toBe('boilerplate');
    expect(classifyPath('src/rate-limit.test.ts')).toBe('boilerplate');
    expect(classifyPath('src/__tests__/helper.ts')).toBe('boilerplate');
  });

  it('demotes only a ROOT vendor/ dir, never a nested first-party one', () => {
    // `vendor/` at the root is the Go/PHP dependency convention. Nested, it is
    // not reliably third-party — this repo's own `client/src/vendor/` is source.
    expect(classifyPath('vendor/github.com/pkg/errors/errors.go')).toBe('boilerplate');
    expect(classifyPath('client/src/vendor/shared/contracts/brief.ts')).toBe('core');
    expect(classifyPath('server/src/vendor/shared/index.ts')).toBe('wiring'); // barrel
    // third_party/ stays unambiguous at any depth.
    expect(classifyPath('client/third_party/lib.js')).toBe('boilerplate');
  });

  it('classifies barrels, entrypoints, config, and CI as wiring', () => {
    expect(classifyPath('src/api/public/index.ts')).toBe('wiring');
    expect(classifyPath('src/server.ts')).toBe('wiring');
    expect(classifyPath('src/config.ts')).toBe('wiring');
    expect(classifyPath('vite.config.ts')).toBe('wiring');
    expect(classifyPath('tsconfig.json')).toBe('wiring');
    expect(classifyPath('Dockerfile')).toBe('wiring');
    expect(classifyPath('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyPath('server/src/db/migrations/0001_init.sql')).toBe('wiring');
  });

  it('demotes drizzle-kit migration META snapshots to boilerplate, but not the SQL', () => {
    // Caught on a real PR: a 3669-line generated snapshot matched the
    // `migrations/` wiring rule and sat in the middle of the wiring group.
    expect(classifyPath('server/src/db/migrations/meta/0014_snapshot.json')).toBe('boilerplate');
    expect(classifyPath('server/src/db/migrations/meta/_journal.json')).toBe('boilerplate');
    expect(classifyPath('server/src/db/migrations/0013_easy.sql')).toBe('wiring');
  });

  it('defaults anything unrecognised to core', () => {
    expect(classifyPath('src/middleware/ratelimit.ts')).toBe('core');
    expect(classifyPath('src/api/public/webhooks.ts')).toBe('core');
    expect(classifyPath('some/unheard/of/thing.rb')).toBe('core');
    // `package.json` is boilerplate but a *file named like* a config module in
    // a feature dir is not — the rules must not over-reach.
    expect(classifyPath('src/features/settings.service.ts')).toBe('core');
  });

  it('prefers the more specific boilerplate rule over the wiring one', () => {
    // Both `package.json` (boilerplate) and the generic config rules could
    // claim these; boilerplate is scanned first and must win.
    expect(classifyPath('package.json')).toBe('boilerplate');
    expect(classifyPath('packages/ui/package.json')).toBe('boilerplate');
  });
});

describe('buildSmartDiff', () => {
  const FILES = [
    file('src/middleware/ratelimit.ts', 84, 0),
    file('src/api/public/webhooks.ts', 31, 6),
    file('src/api/public/index.ts', 12, 2),
    file('src/server.ts', 8, 1),
    file('src/config.ts', 4, 0),
    file('package.json', 3, 1),
    file('package-lock.json', 92, 24),
    file('test/ratelimit.test.ts', 6, 0),
  ];

  it('emits groups in reviewer order: core, then wiring, then boilerplate', () => {
    const out = buildSmartDiff(FILES, []);
    expect(out.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('omits a role with no files instead of emitting an empty group', () => {
    const out = buildSmartDiff([file('src/only/logic.ts')], []);
    expect(out.groups.map((g) => g.role)).toEqual(['core']);
  });

  it('orders findings-first, then by churn, then by path', () => {
    const out = buildSmartDiff(FILES, [
      { file: 'src/api/public/webhooks.ts', start_line: 61 },
      { file: 'src/api/public/webhooks.ts', start_line: 68 },
    ]);
    const core = out.groups.find((g) => g.role === 'core')!;
    // webhooks.ts has fewer changed lines (37) than ratelimit.ts (84) but two
    // findings, so it must sort first — findings outrank size.
    expect(core.files.map((f) => f.path)).toEqual([
      'src/api/public/webhooks.ts',
      'src/middleware/ratelimit.ts',
    ]);
  });

  it('deduplicates and sorts finding_lines, ignoring other files', () => {
    const out = buildSmartDiff([file('src/a.ts')], [
      { file: 'src/a.ts', start_line: 30 },
      { file: 'src/a.ts', start_line: 12 },
      { file: 'src/a.ts', start_line: 30 },
      { file: 'src/b.ts', start_line: 99 },
    ]);
    expect(out.groups[0]!.files[0]!.finding_lines).toEqual([12, 30]);
  });

  it('works with no findings at all — the pre-review state', () => {
    const out = buildSmartDiff(FILES, []);
    for (const group of out.groups) {
      for (const f of group.files) expect(f.finding_lines).toEqual([]);
    }
    expect(out.groups.length).toBe(3);
  });

  it('never invents a pseudocode_summary (Smart Diff makes no LLM call)', () => {
    const out = buildSmartDiff(FILES, []);
    for (const group of out.groups) {
      for (const f of group.files) expect(f.pseudocode_summary).toBeNull();
    }
  });

  it('is stable regardless of the order the files arrive in', () => {
    const forward = buildSmartDiff(FILES, []);
    const reversed = buildSmartDiff([...FILES].reverse(), []);
    expect(reversed).toEqual(forward);
  });

  it('satisfies the SmartDiff contract', () => {
    expect(() => SmartDiff.parse(buildSmartDiff(FILES, []))).not.toThrow();
  });
});

describe('buildSmartDiff — split_suggestion', () => {
  it('is not too_big below the line threshold', () => {
    const out = buildSmartDiff([file('a/x.ts', 10, 5), file('b/y.ts', 4, 1), file('c/z.ts', 1, 1)], []);
    expect(out.split_suggestion.too_big).toBe(false);
    expect(out.split_suggestion.total_lines).toBe(22);
    expect(out.split_suggestion.proposed_splits).toEqual([]);
  });

  it('is not too_big when a huge change touches too few files', () => {
    const huge = [file('src/a/one.ts', SPLIT_TOO_BIG_LINES * 2, 0), file('src/b/two.ts', 10, 0)];
    expect(huge.length).toBeLessThan(SPLIT_MIN_FILES);
    expect(buildSmartDiff(huge, []).split_suggestion.too_big).toBe(false);
  });

  it('proposes seams by feature dir, with all boilerplate in one bucket', () => {
    const out = buildSmartDiff(
      [
        file('src/api/a.ts', 200, 0),
        file('src/api/b.ts', 100, 0),
        file('src/billing/c.ts', 150, 0),
        file('package-lock.json', 400, 0),
        file('src/__snapshots__/x.snap', 20, 0),
      ],
      [],
    );
    const split = out.split_suggestion;
    expect(split.too_big).toBe(true);
    expect(split.total_lines).toBe(870);

    const names = split.proposed_splits.map((p) => p.name);
    expect(names).toContain('src/api');
    expect(names).toContain('src/billing');
    // Both generated files land together regardless of where they live.
    const generated = split.proposed_splits.find((p) => p.name === SPLIT_GENERATED_BUCKET)!;
    expect(generated.files).toEqual(['package-lock.json', 'src/__snapshots__/x.snap']);
  });

  it('proposes nothing when a big change has only one seam', () => {
    const out = buildSmartDiff(
      [file('src/api/a.ts', 200, 0), file('src/api/b.ts', 200, 0), file('src/api/c.ts', 200, 0)],
      [],
    );
    expect(out.split_suggestion.too_big).toBe(true);
    expect(out.split_suggestion.proposed_splits).toEqual([]);
  });
});

describe('findingsFromLatestRunPerAgent', () => {
  const row = (id: string, agentId: string | null, findingIds: string[]) => ({
    review: { id, agentId } as never,
    findings: findingIds.map((f) => ({ id: f }) as never),
  });

  it('unions every agent, not just the newest review row', () => {
    // The real shape of "Run Review (all agents)": three rows seconds apart,
    // each its own run id, and the newest agent found nothing. Taking rows[0]
    // alone (or grouping by run id) loses all three findings.
    const rows = [
      row('rev-c', 'agent-3', []),
      row('rev-b', 'agent-2', ['a', 'b']),
      row('rev-a', 'agent-1', ['c']),
    ];
    expect(findingsFromLatestRunPerAgent(rows).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('lets a re-run supersede only that agent, never double-counting', () => {
    const rows = [
      row('rev-new', 'agent-1', ['fresh']), // agent-1 re-run, newest
      row('rev-old', 'agent-1', ['stale']), // superseded
      row('rev-two', 'agent-2', ['other']), // untouched by the re-run
    ];
    expect(findingsFromLatestRunPerAgent(rows).map((f) => f.id)).toEqual(['fresh', 'other']);
  });

  it('keeps each agentless (seeded) review exactly once', () => {
    const rows = [row('rev-1', null, ['seeded'])];
    expect(findingsFromLatestRunPerAgent(rows).map((f) => f.id)).toEqual(['seeded']);
  });

  it('returns nothing for a PR with no reviews', () => {
    expect(findingsFromLatestRunPerAgent([])).toEqual([]);
  });
});
