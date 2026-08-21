/**
 * PR Brief — the model's evidence, rendered from READY-MADE ARTIFACTS ONLY.
 *
 * PURE. No I/O, no clock, no DB, no LLM call. `brief/service.ts` gathers the
 * artifacts (the persisted intent row, the blast-radius map, the changed-file
 * rows, the latest findings) and hands them here; this module decides what
 * the model sees and — just as important — what it never sees.
 *
 * THE RULE: no patch body ever enters this prompt. A brief answers "what is
 * this PR for and what does each file change", not "what changed line by
 * line"; the raw diff of a mid-sized PR is 5–15k tokens on its own and would
 * blow the brief's whole budget before a single artifact was read. The
 * inputs below are the artifacts the rest of the system already derived —
 * the intent (`pr_intent`), the blast summary + per-symbol map (the index),
 * grouped diff stats (`classifyPath` over `pr_files`, counts only) and the
 * findings that already passed the grounding gate. `PrFileRow.patch` is not
 * even part of this module's input type, so a caller cannot leak it here by
 * accident.
 *
 * BUDGET: everything here is capped per item so the rendered evidence is
 * bounded regardless of PR size — see `BRIEF_EVIDENCE_MAX_CHARS` and the
 * arithmetic next to it. A unit test drives a worst-case input through
 * `renderBriefEvidence` and asserts the ceiling holds.
 */

import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { Intent, Finding, BlastRadiusResult, BlastSymbol, SmartDiffRole } from '@devdigest/shared';
import { classifyPath } from '../smart-diff/index.js';
import type { SummarizableFile, SummaryCandidate } from './summaries.js';

// ---- caps --------------------------------------------------------------------

/** Changed symbols named per file — the noisiest artifact, so the tightest cap. */
export const MAX_SYMBOLS_PER_FILE = 5;
/** Finding titles named per file (highest severity first). */
export const MAX_FINDINGS_PER_FILE = 3;
/** In-scope / out-of-scope bullets carried from the intent, each. */
export const MAX_SCOPE_ITEMS = 5;

const MAX_TITLE_CHARS = 200;
const MAX_INTENT_CHARS = 600;
const MAX_SCOPE_ITEM_CHARS = 100;
const MAX_PATH_CHARS = 140;
const MAX_SYMBOL_CHARS = 48;
const MAX_FINDING_TITLE_CHARS = 90;
const MAX_BLAST_SUMMARY_CHARS = 300;
const MAX_REASON_CHARS = 200;

/**
 * Upper bound on `renderBriefEvidence`'s total output, in characters.
 *
 * Worst case per file: path (140) + stats line (~50) + symbols
 * (5 × (48 name + 16 kind + 32 endpoint + ~45 decoration) ≈ 700) + findings
 * (3 × (90 + ~28) ≈ 350) + wrapper/labels (~80) ≈ 1 330 chars; × 20 files
 * (`MAX_SUMMARIZED_FILES`) ≈ 26 600. Context block worst case ≈ 200 title +
 * 600 intent + 10 × 100 scope + 300 summary + 200 reason + ~300 decoration
 * ≈ 2 600. MEASURED by the unit test with every single cap saturated at
 * once: 29 077 chars ≈ 7.3k tokens at 4 chars/token — and a real PR never
 * saturates them all (a typical path is 40 chars, not 140). The
 * `file-summaries.md` template around it is ~4k chars (~1k tokens), so the
 * whole call stays inside an 8k-token budget even at the ceiling. The test
 * pins this number so a cap change that silently widens the budget fails
 * loudly.
 */
export const BRIEF_EVIDENCE_MAX_CHARS = 30_000;

// ---- inputs --------------------------------------------------------------------

/** One finding, reduced to what a file summary can use — never the rationale. */
export interface FindingHint {
  severity: Finding['severity'];
  title: string;
  line: number;
}

export interface BriefEvidenceInput {
  /** `pull_requests.title` — author-controlled, wrapped as untrusted. */
  title: string;
  /** The persisted `pr_intent` row's content, or `null` when never derived. */
  intent: Intent | null;
  /** Whether that intent was derived at the PR's CURRENT head (false ⇒ stale). */
  intentIsCurrent: boolean;
  /** The blast map, or `null` when reading it failed outright. A `degraded`
   *  result is still passed in — its `reason` is what the model is told. */
  blast: BlastRadiusResult | null;
  /** EVERY changed file — drives the grouped diff stats. Counts only. */
  files: readonly SummarizableFile[];
  /** The files actually being asked about (`selectFilesToSummarize`). */
  selected: readonly SummaryCandidate[];
  /** Latest-per-agent findings, keyed by path. */
  findings: ReadonlyMap<string, readonly FindingHint[]>;
}

export interface BriefEvidence {
  /** PR-level context: title, intent, blast summary, grouped diff stats. */
  context: string;
  /** One wrapped block per selected file, in `selected` order. */
  files: string;
}

// ---- grouped diff stats ---------------------------------------------------------

export interface GroupedDiffStats {
  byRole: Record<SmartDiffRole, { files: number; additions: number; deletions: number }>;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

/** Counts per `classifyPath` bucket — the "how big and what kind" artifact. */
export function groupedDiffStats(files: readonly SummarizableFile[]): GroupedDiffStats {
  const byRole: GroupedDiffStats['byRole'] = {
    core: { files: 0, additions: 0, deletions: 0 },
    wiring: { files: 0, additions: 0, deletions: 0 },
    boilerplate: { files: 0, additions: 0, deletions: 0 },
  };
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    const bucket = byRole[classifyPath(file.path)];
    bucket.files += 1;
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }
  return { byRole, totalFiles: files.length, totalAdditions, totalDeletions };
}

function renderGroupedStats(stats: GroupedDiffStats): string {
  const roles: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];
  const parts = roles
    .filter((role) => stats.byRole[role].files > 0)
    .map((role) => {
      const b = stats.byRole[role];
      return `${b.files} ${role} (+${b.additions}/-${b.deletions})`;
    });
  const head = `${stats.totalFiles} files changed, +${stats.totalAdditions}/-${stats.totalDeletions}`;
  return parts.length > 0 ? `${head}: ${parts.join(', ')}` : head;
}

// ---- helpers ---------------------------------------------------------------------

/** Single-line, length-capped. Collapsing whitespace first keeps one artifact
 *  from spanning lines the template reads as separate facts. */
function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

// Keyed by the REAL `Severity` enum (`contracts/findings.ts`: CRITICAL | WARNING |
// SUGGESTION) — typed against it so a renamed tier fails typecheck instead of
// silently ranking last.
const SEVERITY_RANK: Record<Finding['severity'], number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function renderFindings(hints: readonly FindingHint[]): string {
  const top = [...hints]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_FINDINGS_PER_FILE)
    .map((h) => `[${clamp(h.severity, 12)}] ${clamp(h.title, MAX_FINDING_TITLE_CHARS)} (line ${h.line})`);
  const more = hints.length - top.length;
  return more > 0 ? `${top.join('; ')}; … and ${more} more` : top.join('; ');
}

function renderSymbol(sym: BlastSymbol): string {
  const bits = [clamp(sym.kind, 16), sym.change];
  if (sym.caller_count > 0) bits.push(`${sym.caller_count} caller${sym.caller_count === 1 ? '' : 's'}`);
  const endpoint = sym.endpoints[0];
  if (endpoint) bits.push(`${clamp(endpoint.method, 8)} ${clamp(endpoint.path, 32)}`);
  if (sym.crons.length > 0) bits.push('cron');
  return `${clamp(sym.name, MAX_SYMBOL_CHARS)} (${bits.join(', ')})`;
}

/** Symbols for one path, the ones this PR is ABOUT first (`added` before
 *  `modified`, then most-called first) so a cap cuts the least telling. */
function renderSymbols(symbols: readonly BlastSymbol[]): string {
  const ranked = [...symbols].sort((a, b) => {
    if (a.change !== b.change) return a.change === 'added' ? -1 : 1;
    return b.caller_count - a.caller_count;
  });
  const top = ranked.slice(0, MAX_SYMBOLS_PER_FILE).map(renderSymbol);
  const more = ranked.length - top.length;
  return more > 0 ? `${top.join('; ')}; … and ${more} more` : top.join('; ');
}

// ---- render --------------------------------------------------------------------------

/**
 * Render the evidence the ONE brief model call reads. Every author- or
 * model-originated string (title, intent, scope items, finding titles,
 * symbol names, paths) lands inside an `<untrusted>` block; the template
 * treats it as data. Deterministic for a given input — no clock, no random.
 */
export function renderBriefEvidence(input: BriefEvidenceInput): BriefEvidence {
  // ---- PR-level context ------------------------------------------------
  const ctx: string[] = [];
  ctx.push(`title: ${clamp(input.title, MAX_TITLE_CHARS)}`);

  if (input.intent) {
    const staleNote = input.intentIsCurrent ? '' : ' (derived at an earlier head commit)';
    ctx.push(`intent${staleNote}: ${clamp(input.intent.intent, MAX_INTENT_CHARS)}`);
    const scope = (label: string, items: readonly string[]) => {
      if (items.length === 0) return;
      const shown = items.slice(0, MAX_SCOPE_ITEMS).map((i) => clamp(i, MAX_SCOPE_ITEM_CHARS));
      const more = items.length - shown.length;
      ctx.push(`${label}: ${shown.join('; ')}${more > 0 ? `; … and ${more} more` : ''}`);
    };
    scope('in scope', input.intent.in_scope);
    scope('out of scope', input.intent.out_of_scope);
  } else {
    ctx.push('intent: (not derived yet)');
  }

  if (input.blast) {
    const blastLine = `blast radius (${input.blast.status}): ${clamp(input.blast.summary, MAX_BLAST_SUMMARY_CHARS)}`;
    ctx.push(
      input.blast.reason ? `${blastLine} — ${clamp(input.blast.reason, MAX_REASON_CHARS)}` : blastLine,
    );
  } else {
    ctx.push('blast radius: (unavailable)');
  }

  ctx.push(`diff stats: ${renderGroupedStats(groupedDiffStats(input.files))}`);

  // ---- per-file blocks -------------------------------------------------
  const symbolsByPath = new Map<string, BlastSymbol[]>();
  for (const sym of input.blast?.symbols ?? []) {
    const list = symbolsByPath.get(sym.file);
    if (list) list.push(sym);
    else symbolsByPath.set(sym.file, [sym]);
  }

  const files = input.selected
    .map((candidate, index) => {
      const lines: string[] = [];
      lines.push(`path: ${clamp(candidate.path, MAX_PATH_CHARS)}`);
      const hints = input.findings.get(candidate.path) ?? [];
      const role = classifyPath(candidate.path);
      lines.push(
        `role: ${role} · +${candidate.additions}/-${candidate.deletions} · ${hints.length} finding${hints.length === 1 ? '' : 's'}`,
      );
      const symbols = symbolsByPath.get(candidate.path);
      if (symbols && symbols.length > 0) lines.push(`changed symbols: ${renderSymbols(symbols)}`);
      if (hints.length > 0) lines.push(`findings: ${renderFindings(hints)}`);
      // The label is OURS (an index), never the path — a path is author
      // data and belongs inside the block, not in the delimiter attribute.
      return wrapUntrusted(`file:${index + 1}`, lines.join('\n'));
    })
    .join('\n\n');

  return { context: wrapUntrusted('pr', ctx.join('\n')), files };
}
