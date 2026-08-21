/**
 * T8 (onboarding-tour plan) — the grounding gate.
 *
 * Hermetic: one real temp-directory clone (no DB, no network), read once via
 * the real `collectEvidence`, then exercised against a series of `groundTour`
 * calls covering every lettered acceptance scenario in the T8 task brief.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  OnboardingDraft,
  OnboardingDraftSection,
  OnboardingSection,
  OnboardingSectionKind,
} from '@devdigest/shared';
import { collectEvidence, type EvidenceResult } from '../src/modules/onboarding/evidence.js';
import { groundTour, renderFacts, type GroundingConfig } from '../src/modules/onboarding/helpers.js';
import { SECTION_KINDS } from '../src/modules/onboarding/constants.js';

// `knowledge.ts` only exports the discriminated union `OnboardingSection`,
// not each arm — narrow it locally via `Extract` rather than editing that
// (out-of-scope, already-frozen) contract file.
type ArchitectureSection = Extract<OnboardingSection, { kind: 'architecture' }>;
type CriticalPathsSection = Extract<OnboardingSection, { kind: 'critical_paths' }>;
type RoutesAndApisSection = Extract<OnboardingSection, { kind: 'routes_and_apis' }>;
type LocalSetupSection = Extract<OnboardingSection, { kind: 'local_setup' }>;
type ReadingPathSection = Extract<OnboardingSection, { kind: 'reading_path' }>;
type FirstTasksSection = Extract<OnboardingSection, { kind: 'first_tasks' }>;

const CONFIG: GroundingConfig = {
  onboardingMinSectionItems: 1,
  onboardingMaxCriticalPaths: 8,
  onboardingMaxCommands: 12,
  onboardingMaxReadingPath: 7,
  onboardingMaxFirstTasks: 5,
  onboardingMaxFrontendRoutes: 12,
  onboardingMaxApiEndpoints: 24,
};

/** A full, valid draft section for `kind`, with sensible empty defaults for every field the test doesn't care about. */
function blankSection(kind: OnboardingSectionKind): OnboardingDraftSection {
  return {
    kind,
    title: `Title: ${kind}`,
    body: kind === 'architecture' ? 'Some architecture prose.' : '',
    diagram: null,
    links: [],
    critical_paths: [],
    routes: [],
    commands: [],
    reading_path: [],
    first_tasks: [],
  };
}

/** A full six-section draft, all blank, with `overrides` merged per kind. */
function makeDraft(overrides: Partial<Record<OnboardingSectionKind, Partial<OnboardingDraftSection>>>): OnboardingDraft {
  return {
    sections: SECTION_KINDS.map((kind) => ({ ...blankSection(kind), ...(overrides[kind] ?? {}) })),
  };
}

describe('onboarding grounding gate (T8)', () => {
  let root: string;
  let evidence: EvidenceResult;

  beforeAll(async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'devdigest-onboarding-'));
    root = path.join(base, 'clone');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'specs'), { recursive: true });

    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture-repo',
        packageManager: 'pnpm@8.15.0',
        scripts: { build: 'tsc', test: 'vitest' },
      }),
      'utf8',
    );
    await writeFile(
      path.join(root, 'README.md'),
      [
        '# Fixture repo',
        '',
        'Install deps:',
        '',
        '```bash',
        'pnpm install',
        '```',
        '',
        'Run tests with `pnpm test`.',
      ].join('\n'),
      'utf8',
    );
    // Deliberately no Makefile — proves AC-9(b)'s negative case.
    await writeFile(path.join(root, 'specs', '.gitkeep'), '', 'utf8');
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const main = () => {};\n', 'utf8');
    await writeFile(path.join(root, 'src', 'app.ts'), 'export const app = () => {};\n', 'utf8');
    await writeFile(path.join(root, 'src', 'foo.test.ts'), "it('x', () => {});\n", 'utf8');

    evidence = await collectEvidence(root, { maxExcerptFiles: 10, excerptCharCap: 4000 });
  });

  afterAll(async () => {
    await rm(path.dirname(root), { recursive: true, force: true });
  });

  it('collectEvidence attests pnpm (declared packageManager) and does NOT attest make (no Makefile present)', () => {
    expect(evidence.commandAttestations.has('pnpm')).toBe(true);
    expect(evidence.commandAttestations.has('make')).toBe(false);
  });

  // (a) a draft citing src/does-not-exist.ts in critical_paths, reading_path
  // and first_tasks stores none of the three (AC-8).
  it('(a) drops an ungrounded path from critical_paths, reading_path, and first_tasks alike', async () => {
    const draft = makeDraft({
      critical_paths: { critical_paths: [{ path: 'src/does-not-exist.ts', why: 'nope' }] },
      reading_path: { reading_path: [{ path: 'src/does-not-exist.ts', rationale: 'nope' }] },
      first_tasks: {
        first_tasks: [{ title: 'x', target: 'src/does-not-exist.ts', complexity: 'low' }],
      },
    });
    // `rank` deliberately does NOT include the fake path — it isn't
    // indexed, so it must be grounded on neither source (AC-8).
    const rank = ['src/index.ts', 'src/app.ts'];
    const sections = await groundTour(draft, evidence, rank, new Set(), CONFIG);

    const critical = sections.find((s) => s.kind === 'critical_paths') as CriticalPathsSection;
    const reading = sections.find((s) => s.kind === 'reading_path') as ReadingPathSection;
    const first = sections.find((s) => s.kind === 'first_tasks') as FirstTasksSection;

    expect(critical.items).toEqual([]);
    expect(reading.items).toEqual([]);
    expect(first.items).toEqual([]);
  });

  // (b) `make deploy-prod` dropped (no Makefile); `pnpm install` survives
  // (package.json declares pnpm) (AC-9).
  it('(b) drops an unattested command and keeps an attested one', async () => {
    const draft = makeDraft({
      local_setup: { commands: [{ command: 'make deploy-prod' }, { command: 'pnpm install' }] },
    });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);
    const local = sections.find((s) => s.kind === 'local_setup') as LocalSetupSection;
    expect(local.items).toEqual([{ command: 'pnpm install' }]);
  });

  // (c) first_tasks all citing missing paths yields an empty section with
  // insufficient_grounding and nothing fabricated (AC-10).
  it('(c) an all-ungrounded first_tasks list stores empty with insufficient_grounding', async () => {
    const draft = makeDraft({
      first_tasks: {
        first_tasks: [{ title: 'x', target: 'nowhere.ts', complexity: 'low' }],
      },
    });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);
    const first = sections.find((s) => s.kind === 'first_tasks') as FirstTasksSection;
    expect(first.items).toEqual([]);
    expect(first.empty_reason).toBe('insufficient_grounding');
  });

  // (d) a diagram on first_tasks is discarded while the same string on
  // routes_and_apis is kept (AC-13).
  it('(d) strips diagram outside DIAGRAM_KINDS but keeps it on routes_and_apis', async () => {
    const mermaid = 'flowchart TD\nA-->B';
    const draft = makeDraft({
      first_tasks: { diagram: mermaid },
      routes_and_apis: { diagram: mermaid },
    });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);
    const first = sections.find((s) => s.kind === 'first_tasks') as FirstTasksSection;
    const routes = sections.find((s) => s.kind === 'routes_and_apis') as RoutesAndApisSection;
    expect(first.diagram).toBeNull();
    expect(routes.diagram).toBe(mermaid);
  });

  // (e) shuffling the model's critical_paths order does not change the
  // stored (rank-descending) order (AC-16), and a top-ranked test file never
  // surfaces (AC-17).
  it('(e) derives critical_paths order strictly from rank, ignoring the model order and junk paths', async () => {
    const rank = ['src/foo.test.ts', 'src/index.ts', 'src/app.ts']; // foo.test.ts ranked FIRST on purpose
    const itemA = { path: 'src/app.ts', why: 'a' };
    const itemB = { path: 'src/foo.test.ts', why: 'junk' };
    const itemC = { path: 'src/index.ts', why: 'c' };

    const draft1 = makeDraft({ critical_paths: { critical_paths: [itemA, itemB, itemC] } });
    const draft2 = makeDraft({ critical_paths: { critical_paths: [itemC, itemA, itemB] } }); // shuffled

    const sections1 = await groundTour(draft1, evidence, rank, new Set(), CONFIG);
    const sections2 = await groundTour(draft2, evidence, rank, new Set(), CONFIG);

    const critical1 = sections1.find((s) => s.kind === 'critical_paths') as CriticalPathsSection;
    const critical2 = sections2.find((s) => s.kind === 'critical_paths') as CriticalPathsSection;

    // foo.test.ts never surfaces despite being top-ranked (AC-17).
    expect(critical1.items.some((i) => i.path === 'src/foo.test.ts')).toBe(false);
    // Rank-derived order: index.ts (rank 1) before app.ts (rank 2).
    expect(critical1.items.map((i) => i.path)).toEqual(['src/index.ts', 'src/app.ts']);
    expect(critical2.items).toEqual(critical1.items);
  });

  // (f) a DELETE /users/:id no fact attests is dropped when facts exist, and
  // survives (facts_unavailable: true) when the fact set is empty (AC-52).
  it('(f) drops an unattested API entry when facts exist, keeps it with facts_unavailable when they do not', async () => {
    const entry = {
      surface: 'api' as const,
      group: 'users',
      method: 'DELETE',
      route: '/users/:id',
      source_path: 'src/app.ts',
      note: null,
    };
    const draftWithFacts = makeDraft({ routes_and_apis: { routes: [entry] } });
    const withFacts = await groundTour(draftWithFacts, evidence, [], new Set(['GET /health']), CONFIG);
    const routesWithFacts = withFacts.find((s) => s.kind === 'routes_and_apis') as RoutesAndApisSection;
    expect(routesWithFacts.items).toEqual([]);
    expect(routesWithFacts.facts_unavailable).toBe(false);

    const draftNoFacts = makeDraft({ routes_and_apis: { routes: [entry] } });
    const withoutFacts = await groundTour(draftNoFacts, evidence, [], new Set(), CONFIG);
    const routesNoFacts = withoutFacts.find((s) => s.kind === 'routes_and_apis') as RoutesAndApisSection;
    expect(routesNoFacts.items).toEqual([entry]);
    expect(routesNoFacts.facts_unavailable).toBe(true);
  });

  // (g) a repeated GET /health stores once, and two identical inputs yield
  // identical entry order (AC-53).
  it('(g) de-duplicates a repeated route and is order-deterministic across identical inputs', async () => {
    const entry = {
      surface: 'api' as const,
      group: 'health',
      method: 'GET',
      route: '/health',
      source_path: 'src/app.ts',
      note: null,
    };
    const draft = makeDraft({ routes_and_apis: { routes: [entry, entry] } });
    const facts = new Set(['GET /health']);
    const run1 = await groundTour(draft, evidence, [], facts, CONFIG);
    const run2 = await groundTour(draft, evidence, [], facts, CONFIG);
    const routes1 = run1.find((s) => s.kind === 'routes_and_apis') as RoutesAndApisSection;
    const routes2 = run2.find((s) => s.kind === 'routes_and_apis') as RoutesAndApisSection;
    expect(routes1.items).toEqual([entry]);
    expect(routes2.items).toEqual(routes1.items);
  });

  // (h) an entry with no source_path, and one whose source_path is missing
  // from the repo, are both dropped (AC-51).
  it('(h) drops a routes_and_apis entry with no source_path and one whose source_path is absent', async () => {
    const noSourcePath = {
      surface: 'api' as const,
      group: 'g',
      method: 'GET',
      route: '/a',
      source_path: '',
      note: null,
    };
    const missingSourcePath = {
      surface: 'api' as const,
      group: 'g',
      method: 'GET',
      route: '/b',
      source_path: 'src/missing.ts',
      note: null,
    };
    const draft = makeDraft({ routes_and_apis: { routes: [noSourcePath, missingSourcePath] } });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);
    const routes = sections.find((s) => s.kind === 'routes_and_apis') as RoutesAndApisSection;
    expect(routes.items).toEqual([]);
  });

  // (i) a path repeated at positions 2 and 5 of reading_path stores once at
  // position 2 with contiguous numbering (AC-20).
  it('(i) de-duplicates reading_path keeping the earlier position, contiguously renumbered', async () => {
    const draft = makeDraft({
      reading_path: {
        reading_path: [
          { path: 'package.json', rationale: 'r1' },
          { path: 'README.md', rationale: 'r2' },
          { path: 'src/index.ts', rationale: 'r3' },
          { path: 'src/app.ts', rationale: 'r4' },
          { path: 'README.md', rationale: 'r5-dup' },
        ],
      },
    });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);
    const reading = sections.find((s) => s.kind === 'reading_path') as ReadingPathSection;
    expect(reading.items.map((i) => i.path)).toEqual([
      'package.json',
      'README.md',
      'src/index.ts',
      'src/app.ts',
    ]);
    expect(reading.items[1]!.rationale).toBe('r2'); // the EARLIER occurrence's rationale survives
  });

  // (j) complexity: "trivial" and "Low complexity" both drop the item, while
  // a specs/ target that exists as a directory survives (AC-22, AC-23).
  it('(j) drops an unrecognized complexity value without coercing, and keeps an existing directory target', async () => {
    const draft = makeDraft({
      first_tasks: {
        first_tasks: [
          { title: 'a', target: 'src/index.ts', complexity: 'trivial' as never },
          { title: 'b', target: 'src/app.ts', complexity: 'Low complexity' as never },
          { title: 'c', target: 'specs', complexity: 'low' },
        ],
      },
    });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);
    const first = sections.find((s) => s.kind === 'first_tasks') as FirstTasksSection;
    expect(first.items).toEqual([{ title: 'c', target: 'specs', complexity: 'low' }]);
  });

  // (k) a seven-section or five-section draft is rejected (AC-1).
  it('(k) rejects a seven-section draft and a five-section draft', async () => {
    const sevenSections: OnboardingDraft = {
      sections: [...SECTION_KINDS.map(blankSection), blankSection('architecture')],
    };
    const fiveSections: OnboardingDraft = {
      sections: SECTION_KINDS.filter((k) => k !== 'first_tasks').map(blankSection),
    };
    await expect(groundTour(sevenSections, evidence, [], new Set(), CONFIG)).rejects.toThrow();
    await expect(groundTour(fiveSections, evidence, [], new Set(), CONFIG)).rejects.toThrow();
  });

  // (l) the rendered user message contains one <untrusted block per excerpt
  // (AC-12).
  it('(l) renderFacts wraps every excerpt in its own <untrusted> block', () => {
    const message = renderFacts({
      repoFullName: 'acme/fixture-repo',
      excerpts: evidence.excerpts,
      commandAttestations: [...evidence.commandAttestations],
      endpointFacts: ['GET /health'],
      criticalPaths: [['src/index.ts', 'src/app.ts']],
    });
    const untrustedBlocks = message.match(/<untrusted /g) ?? [];
    expect(untrustedBlocks).toHaveLength(evidence.excerpts.length);
    expect(evidence.excerpts.length).toBeGreaterThan(0); // sanity: the fixture actually has excerpts to wrap
  });

  // (m) links are grounded like any other cited path (AC-8), on EVERY
  // section including architecture (which has no item array), and losing
  // every link never triggers AC-10's insufficient_grounding — that's an
  // items-only signal.
  it('(m) grounds links on every section without letting a link-only loss mark the section insufficient_grounding', async () => {
    const draft = makeDraft({
      architecture: {
        links: [
          { label: 'Real', path: 'src/index.ts' },
          { label: 'Fake', path: 'src/does-not-exist.ts' },
        ],
      },
      local_setup: {
        commands: [{ command: 'pnpm install' }], // grounded — a healthy, non-empty section
        links: [{ label: 'Fake', path: 'src/does-not-exist.ts' }], // grounds to nothing
      },
    });
    const sections = await groundTour(draft, evidence, [], new Set(), CONFIG);

    const architecture = sections.find((s) => s.kind === 'architecture') as ArchitectureSection;
    expect(architecture.links).toEqual([{ label: 'Real', path: 'src/index.ts' }]);

    const localSetup = sections.find((s) => s.kind === 'local_setup') as LocalSetupSection;
    expect(localSetup.links).toEqual([]);
    expect(localSetup.items).toEqual([{ command: 'pnpm install' }]); // items untouched by the link loss
    expect(localSetup.empty_reason).toBeFalsy(); // NOT insufficient_grounding — links don't count
  });
});
