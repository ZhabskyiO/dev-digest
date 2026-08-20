/**
 * Onboarding module (T8) — pure, no I/O. This is the deterministic half of
 * generation: `renderFacts` composes the model-facing user message,
 * `groundTour` turns the model's raw draft into the stored, checkable
 * `OnboardingSection[]`.
 *
 * `groundTour` is pure on purpose: it receives every fact it needs
 * (`evidence`, `rank`, `endpointFacts`, `config`) as arguments and never
 * reaches into a DB or the filesystem itself. The one exception to "pure
 * means synchronous" is that `evidence.fileExists`/`dirExists` ARE I/O-backed
 * promises (owned entirely by `evidence.ts`) — `groundTour` awaits them the
 * same way `reviewer-core` awaits an injected `LLMProvider`: the I/O lives
 * behind an injected seam, not inline in this file.
 *
 * Security: every excerpt of repository text is THIRD-PARTY content that may
 * try to instruct the model directly (a comment saying "ignore prior
 * instructions", a README claiming to be "the real system prompt", etc.).
 * `renderFacts` wraps every excerpt in `wrapUntrusted` (AC-12) — the same
 * defense used at `modules/conventions/service.ts:246` — and relies on the
 * ONE shared `INJECTION_GUARD` rule baked into `assemblePrompt`
 * (`reviewer-core/src/prompt.ts`), not a keyword denylist. Do not add one.
 */
import type { AppConfig } from '../../platform/config.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { ValidationError } from '../../platform/errors.js';
import type {
  OnboardingDraft,
  OnboardingDraftSection,
  OnboardingSection,
  OnboardingSectionKind,
  OnboardingCriticalPath,
  OnboardingRouteEntry,
  OnboardingCommand,
  OnboardingReadingStep,
  OnboardingFirstTask,
  OnboardingLink,
} from '@devdigest/shared';
import { SECTION_KINDS, EXCLUDED_PATH_SEGMENTS } from './constants.js';
import type { EvidenceFile, EvidenceResult } from './evidence.js';

// ---- renderFacts (user message assembly) -----------------------------------

export interface OnboardingFactsInput {
  /** Trusted — comes from `repos.full_name`, not repository content. */
  repoFullName: string;
  /** From `EvidenceResult.excerpts` — untrusted repository text (AC-12). */
  excerpts: EvidenceFile[];
  /** From `EvidenceResult.commandAttestations`, rendered for the model's benefit only — `groundTour` re-checks every command independently regardless of what the model does with this hint. */
  commandAttestations: string[];
  /** "METHOD /path" strings from repo-intel's endpoint facts. */
  endpointFacts: string[];
  /** repo-intel rank + import-graph chains — informational only; `groundTour` derives the STORED order independently, never from what the model does with this hint. */
  criticalPaths: string[][];
}

/**
 * Composes the onboarding-generation user message. Every repository excerpt
 * is wrapped in `wrapUntrusted` (AC-12) — one block per excerpt, matching the
 * precedent at `modules/conventions/service.ts:246`.
 */
export function renderFacts(facts: OnboardingFactsInput): string {
  const lines: string[] = [];

  lines.push(`Repository: ${facts.repoFullName}`);
  lines.push('');

  lines.push('Key file excerpts:');
  if (facts.excerpts.length === 0) {
    lines.push('(none found)');
  } else {
    for (const excerpt of facts.excerpts) {
      lines.push(`FILE: ${excerpt.path}`);
      lines.push(wrapUntrusted(excerpt.path, excerpt.body));
      lines.push('');
    }
  }

  lines.push(
    'Attested setup commands (leading executable/script/target names only — ' +
      'cite full, real commands; anything not grounded here is dropped before storage):',
  );
  lines.push(facts.commandAttestations.length > 0 ? facts.commandAttestations.join(', ') : '(none found)');
  lines.push('');

  lines.push('Known API endpoint facts (METHOD /path — do not invent any not listed here):');
  lines.push(facts.endpointFacts.length > 0 ? facts.endpointFacts.join('\n') : '(none extracted)');
  lines.push('');

  lines.push(
    'Candidate critical-path chains (repo-intel rank + import graph, most important first — ' +
      'informational; the stored order is derived from this data independently of your response):',
  );
  if (facts.criticalPaths.length === 0) {
    lines.push('(none available)');
  } else {
    for (const chain of facts.criticalPaths) lines.push(chain.join(' -> '));
  }

  return lines.join('\n');
}

// ---- groundTour (the grounding gate) ---------------------------------------

/** The subset of `AppConfig` `groundTour` needs — kept narrow so a test fixture doesn't need a full `AppConfig`. */
export type GroundingConfig = Pick<
  AppConfig,
  | 'onboardingMinSectionItems'
  | 'onboardingMaxCriticalPaths'
  | 'onboardingMaxCommands'
  | 'onboardingMaxReadingPath'
  | 'onboardingMaxFirstTasks'
  | 'onboardingMaxFrontendRoutes'
  | 'onboardingMaxApiEndpoints'
>;

const PERMITTED_COMPLEXITY = new Set(['low', 'medium', 'high']);

/** True iff `p` contains one of `EXCLUDED_PATH_SEGMENTS` (tests/fixtures/configs/declarations/migrations — AC-17). */
function isJunkPath(p: string): boolean {
  return EXCLUDED_PATH_SEGMENTS.some((segment) => p.includes(segment));
}

/**
 * Validates the draft carries exactly the six `SECTION_KINDS`, each exactly
 * once, in any input order (AC-1). Throws — never returns a partial result —
 * on a missing, duplicated, or unexpected kind, since there is no safe
 * "grounded" reading of a structurally wrong draft.
 */
function assertSectionShape(
  draft: OnboardingDraft,
): Map<OnboardingSectionKind, OnboardingDraftSection> {
  const byKind = new Map<OnboardingSectionKind, OnboardingDraftSection>();
  for (const section of draft.sections) {
    if (byKind.has(section.kind)) {
      throw new ValidationError(
        `Onboarding draft has a duplicate section kind: ${section.kind}`,
      );
    }
    byKind.set(section.kind, section);
  }
  for (const kind of SECTION_KINDS) {
    if (!byKind.has(kind)) {
      throw new ValidationError(`Onboarding draft is missing the required section kind: ${kind}`);
    }
  }
  if (byKind.size !== SECTION_KINDS.length) {
    throw new ValidationError('Onboarding draft has an unexpected number of sections');
  }
  return byKind;
}

/** De-duplicates by a derived key, keeping the EARLIER occurrence (AC-20's convention, reused wherever de-dup is needed). */
function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function groundCriticalPaths(
  items: OnboardingCriticalPath[],
  rank: readonly string[],
  maxItems: number,
): Promise<OnboardingCriticalPath[]> {
  // `rank` (repoIntel.getTopFilesByRank + getCriticalPaths, T10's job to
  // build) IS "the repository's index" for this section: AC-16 requires the
  // stored order to be DERIVED from rank, never from the model's own order,
  // so a path absent from `rank` has no legitimate derived position and is
  // dropped rather than appended in some invented order. This is stricter
  // than AC-8's general "indexed nor resolvable in clone" (which would allow
  // a real-but-unranked file to survive) — deliberately, because keeping it
  // would mean falling back to the model's order for that one item, which is
  // exactly what AC-16 forbids. Callers of `groundTour` should pass a `rank`
  // that reasonably covers every file worth surfacing, not just a top-5.
  const rankIndex = new Map(rank.map((p, i) => [p, i]));
  const grounded = items.filter((item) => !isJunkPath(item.path) && rankIndex.has(item.path));
  const deduped = dedupeBy(grounded, (item) => item.path);
  deduped.sort((a, b) => rankIndex.get(a.path)! - rankIndex.get(b.path)!);
  return deduped.slice(0, Math.max(0, maxItems));
}

async function groundRoutes(
  items: OnboardingRouteEntry[],
  evidence: EvidenceResult,
  endpointFacts: ReadonlySet<string>,
  maxFrontend: number,
  maxApi: number,
): Promise<{ items: OnboardingRouteEntry[]; factsUnavailable: boolean; capped: boolean }> {
  const factsUnavailable = endpointFacts.size === 0;

  const groundedFlags = await Promise.all(
    items.map(async (item) => {
      if (!item.source_path) return false; // AC-51: no declaring file at all
      if (!(await evidence.fileExists(item.source_path))) return false; // AC-51: declaring file absent from clone
      if (item.surface === 'api' && !factsUnavailable) {
        const key = `${(item.method ?? '').toUpperCase()} ${item.route}`;
        if (!endpointFacts.has(key)) return false; // AC-52
      }
      return true;
    }),
  );
  const grounded = items.filter((_, i) => groundedFlags[i]);

  const deduped = dedupeBy(
    grounded,
    (item) => `${item.surface}::${(item.method ?? '').toUpperCase()}::${item.route}`,
  ); // AC-53 de-dup

  // AC-53 deterministic order: surface, then group, then route, then method.
  // Plain codepoint comparison, NEVER localeCompare — must be identical
  // regardless of the running environment's locale.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  deduped.sort((a, b) => {
    return (
      cmp(a.surface, b.surface) ||
      cmp(a.group, b.group) ||
      cmp(a.route, b.route) ||
      cmp(a.method ?? '', b.method ?? '')
    );
  });

  // Per-surface caps, applied while preserving the order established above.
  const counts: Record<string, number> = { frontend: 0, api: 0 };
  let capped = false;
  const out: OnboardingRouteEntry[] = [];
  for (const item of deduped) {
    const max = item.surface === 'frontend' ? maxFrontend : maxApi;
    if ((counts[item.surface] ?? 0) >= max) {
      capped = true;
      continue;
    }
    counts[item.surface] = (counts[item.surface] ?? 0) + 1;
    out.push(item);
  }

  return { items: out, factsUnavailable, capped };
}

async function groundCommands(
  items: OnboardingCommand[],
  evidence: EvidenceResult,
  maxItems: number,
): Promise<OnboardingCommand[]> {
  const kept = items.filter((item) => {
    const head = item.command.trim().split(/\s+/)[0];
    return !!head && evidence.commandAttestations.has(head); // AC-9
  });
  const deduped = dedupeBy(kept, (item) => item.command);
  return deduped.slice(0, Math.max(0, maxItems));
}

async function groundReadingPath(
  items: OnboardingReadingStep[],
  evidence: EvidenceResult,
  maxItems: number,
): Promise<OnboardingReadingStep[]> {
  const flags = await Promise.all(items.map((item) => evidence.fileExists(item.path))); // AC-8: files only
  const grounded = items.filter((_, i) => flags[i]);
  // AC-20: de-dup by path, keep the earlier position — dedupeBy already does
  // exactly this, and preserving array order gives contiguous renumbering
  // "for free" (there is no separate `position` field to renumber).
  const deduped = dedupeBy(grounded, (item) => item.path);
  return deduped.slice(0, Math.max(0, maxItems));
}

/**
 * Grounds the `links` array carried by EVERY section (including
 * `architecture`, which has no item array of its own) — a link is exactly as
 * capable of naming an invented file as a `critical_paths`/`reading_path`
 * item is, and it is the one that becomes a clickable control on the page
 * (AC-8). A link target may be a directory, consistent with AC-23's
 * treatment of `first_tasks.target`. Uses the same `rank`-or-clone OR check
 * AC-8 describes generally (unlike `groundCriticalPaths`, which deliberately
 * restricts itself to `rank` alone for ORDERING reasons that don't apply
 * here — a link has no order to derive, so "in rank OR resolvable in the
 * clone" is the right, permissive reading of AC-8 for this field).
 *
 * Links are NOT items: this function's result must never feed
 * `emptyReasonFor`/`config.onboardingMinSectionItems` (AC-10 is scoped to
 * each section's typed item array only) — a section with solid items and
 * zero surviving links is still a healthy, non-empty section.
 */
async function groundLinks(
  links: OnboardingLink[],
  rank: readonly string[],
  evidence: EvidenceResult,
): Promise<OnboardingLink[]> {
  const rankSet = new Set(rank);
  const flags = await Promise.all(
    links.map(async (link) => {
      if (rankSet.has(link.path)) return true;
      const [isFile, isDir] = await Promise.all([
        evidence.fileExists(link.path),
        evidence.dirExists(link.path),
      ]);
      return isFile || isDir;
    }),
  );
  return links.filter((_, i) => flags[i]);
}

async function groundFirstTasks(
  items: OnboardingFirstTask[],
  evidence: EvidenceResult,
  maxItems: number,
): Promise<OnboardingFirstTask[]> {
  const flags = await Promise.all(
    items.map(async (item) => {
      // AC-22: validated at RUNTIME, never trusting the static type — a
      // structured-output response is not guaranteed to actually respect the
      // schema it was asked for, and this is precisely the layer meant to
      // catch that. Never coerce a near-miss like "Low complexity".
      if (!PERMITTED_COMPLEXITY.has(item.complexity as string)) return false;
      // AC-23: a first_tasks target may be a FILE or a DIRECTORY.
      const [isFile, isDir] = await Promise.all([
        evidence.fileExists(item.target),
        evidence.dirExists(item.target),
      ]);
      return isFile || isDir;
    }),
  );
  const grounded = items.filter((_, i) => flags[i]);
  const deduped = dedupeBy(grounded, (item) => item.target);
  return deduped.slice(0, Math.max(0, maxItems));
}

/**
 * Grounds a raw model draft into the stored `OnboardingSection[]`. Order of
 * operations: (1) validate section shape (AC-1), (2) strip `diagram` outside
 * `DIAGRAM_KINDS` (AC-13), (3) per-kind grounding/de-dup/ordering/caps
 * (AC-8/9/16/17/20/22/23/51/52/53), (4) `empty_reason` for any item-bearing
 * section left below `config.onboardingMinSectionItems` (AC-10).
 */
export async function groundTour(
  draft: OnboardingDraft,
  evidence: EvidenceResult,
  rank: readonly string[],
  endpointFacts: ReadonlySet<string>,
  config: GroundingConfig,
): Promise<OnboardingSection[]> {
  const byKind = assertSectionShape(draft);

  const architectureDraft = byKind.get('architecture')!;
  const criticalPathsDraft = byKind.get('critical_paths')!;
  const routesDraft = byKind.get('routes_and_apis')!;
  const localSetupDraft = byKind.get('local_setup')!;
  const readingPathDraft = byKind.get('reading_path')!;
  const firstTasksDraft = byKind.get('first_tasks')!;

  const [
    criticalPaths,
    routesResult,
    commands,
    readingPath,
    firstTasks,
    architectureLinks,
    criticalPathsLinks,
    routesLinks,
    localSetupLinks,
    readingPathLinks,
    firstTasksLinks,
  ] = await Promise.all([
    groundCriticalPaths(criticalPathsDraft.critical_paths, rank, config.onboardingMaxCriticalPaths),
    groundRoutes(
      routesDraft.routes,
      evidence,
      endpointFacts,
      config.onboardingMaxFrontendRoutes,
      config.onboardingMaxApiEndpoints,
    ),
    groundCommands(localSetupDraft.commands, evidence, config.onboardingMaxCommands),
    groundReadingPath(readingPathDraft.reading_path, evidence, config.onboardingMaxReadingPath),
    groundFirstTasks(firstTasksDraft.first_tasks, evidence, config.onboardingMaxFirstTasks),
    // Every section's `links` is grounded the same way (AC-8), architecture
    // included — see `groundLinks`'s doc comment for why this is NOT wired
    // into `emptyReasonFor` below.
    groundLinks(architectureDraft.links, rank, evidence),
    groundLinks(criticalPathsDraft.links, rank, evidence),
    groundLinks(routesDraft.links, rank, evidence),
    groundLinks(localSetupDraft.links, rank, evidence),
    groundLinks(readingPathDraft.links, rank, evidence),
    groundLinks(firstTasksDraft.links, rank, evidence),
  ]);

  const emptyReasonFor = (count: number): string | null =>
    count < config.onboardingMinSectionItems ? 'insufficient_grounding' : null;

  const sections: OnboardingSection[] = [
    {
      kind: 'architecture',
      title: architectureDraft.title,
      body: architectureDraft.body,
      diagram: architectureDraft.diagram, // AC-13: diagram permitted on this kind
      links: architectureLinks,
    },
    (() => {
      const reason = emptyReasonFor(criticalPaths.length);
      return {
        kind: 'critical_paths' as const,
        title: criticalPathsDraft.title,
        items: reason ? [] : criticalPaths,
        diagram: null, // AC-13: never permitted on this kind
        links: criticalPathsLinks,
        empty_reason: reason,
      };
    })(),
    (() => {
      const reason = emptyReasonFor(routesResult.items.length);
      return {
        kind: 'routes_and_apis' as const,
        title: routesDraft.title,
        diagram: routesDraft.diagram, // AC-13: diagram permitted on this kind
        items: reason ? [] : routesResult.items,
        facts_unavailable: routesResult.factsUnavailable,
        items_capped: routesResult.capped,
        links: routesLinks,
        empty_reason: reason,
      };
    })(),
    (() => {
      const reason = emptyReasonFor(commands.length);
      return {
        kind: 'local_setup' as const,
        title: localSetupDraft.title,
        items: reason ? [] : commands,
        diagram: null,
        links: localSetupLinks,
        empty_reason: reason,
      };
    })(),
    (() => {
      const reason = emptyReasonFor(readingPath.length);
      return {
        kind: 'reading_path' as const,
        title: readingPathDraft.title,
        items: reason ? [] : readingPath,
        diagram: null,
        links: readingPathLinks,
        empty_reason: reason,
      };
    })(),
    (() => {
      const reason = emptyReasonFor(firstTasks.length);
      return {
        kind: 'first_tasks' as const,
        title: firstTasksDraft.title,
        items: reason ? [] : firstTasks,
        diagram: null,
        links: firstTasksLinks,
        empty_reason: reason,
      };
    })(),
  ];

  return sections;
}
