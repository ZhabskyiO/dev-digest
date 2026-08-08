import { wrapUntrusted } from '@devdigest/reviewer-core';

/**
 * Pure evidence-extraction helpers for the Intent Layer.
 *
 * PURE — no imports from `db/`, `adapters/`, `platform/container`, `fs`, or
 * `node:fs`. Plain functions over plain data only, so this module is testable
 * without a database and safe to call from anywhere (service, tests, a future
 * dev script) without pulling in I/O. `@devdigest/reviewer-core` is itself
 * pure (no I/O, per `layer-map.md` §1), so importing `wrapUntrusted` from it
 * does not break that guarantee.
 */

// ---- normalizeBody ---------------------------------------------------------

/**
 * Strip PR-template noise so an unfilled template correctly reads as "no
 * documentation" instead of contributing to `isSubstantiveProse`.
 *
 * Order matters: HTML comments (template instructions) → fenced code blocks →
 * checkbox lines → bare images/badges + standalone URLs → heading-only lines
 * → collapse whitespace.
 */
export function normalizeBody(body: string): string {
  let text = body;

  // HTML comments (PR-template instructions, e.g. `<!-- fill this in -->`).
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Fenced code blocks.
  text = text.replace(/```[\s\S]*?```/g, ' ');

  // Markdown checkbox lines (`- [ ]` / `- [x]`).
  text = text.replace(/^[ \t]*-[ \t]*\[[ xX]\].*$/gm, ' ');

  // Bare image/badge markdown.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

  // Standalone URLs — a line that is only a URL.
  text = text.replace(/^[ \t]*https?:\/\/\S+[ \t]*$/gm, ' ');

  // Heading-only lines.
  text = text.replace(/^#{1,6}\s+\S+$/gm, ' ');

  // Collapse whitespace.
  return text.replace(/\s+/g, ' ').trim();
}

// ---- isSubstantiveProse -----------------------------------------------------

export const MIN_PROSE_CHARS = 200;
export const MIN_PROSE_SENTENCES = 2;

/** Sentence terminator: `[.!?]` followed by whitespace or end-of-string. */
const SENTENCE_TERMINATOR_RE = /[.!?](?=\s|$)/g;

export function isSubstantiveProse(normalized: string): boolean {
  if (normalized.length < MIN_PROSE_CHARS) return false;
  const matches = normalized.match(SENTENCE_TERMINATOR_RE);
  return (matches?.length ?? 0) >= MIN_PROSE_SENTENCES;
}

// ---- extractTicketRefs ------------------------------------------------------

// Moved to `platform/ticket-refs.ts` so an infrastructure adapter
// (`adapters/github/octokit.ts`) can consume it without importing a feature
// module (`adapters-dont-know-modules` in `.dependency-cruiser.cjs`).
// Re-exported here so existing callers of this module keep working unchanged.
export { extractTicketRefs, type TicketRef } from '../../../platform/ticket-refs.js';

// ---- extractDocRefs ---------------------------------------------------------

/** Candidate path tokens ending in `.md`, with no whitespace/bracket chars. */
const DOC_REF_RE = /[^\s()<>[\]"'`]+\.md\b/gi;

// Allowlist: docs/** or specs/** at any depth, README.md at any depth, and
// RFC*.md / ADR*.md filenames. NOTE: this comment deliberately avoids writing
// the glob patterns literally with a trailing "*/" — that sequence closes a
// block comment early (see the recurring-errors entry in server/insights.md).
function isAllowedDocRef(rel: string): boolean {
  const segments = rel.split('/');
  const base = segments[segments.length - 1] ?? '';

  // A `docs` or `specs` directory segment anywhere in the path (covers both
  // the root-level and `*/`-nested forms of the allowlist).
  const hasAllowedDir = segments
    .slice(0, -1)
    .some((seg) => seg === 'docs' || seg === 'specs');
  if (hasAllowedDir) return true;

  if (base === 'README.md') return true;
  if (/^RFC.*\.md$/i.test(base)) return true;
  if (/^ADR.*\.md$/i.test(base)) return true;

  return false;
}

export function extractDocRefs(normalizedBody: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const match of normalizedBody.matchAll(DOC_REF_RE)) {
    const raw = match[0];
    if (!raw) continue;

    // Defence in depth — `docs.ts` (T9) checks again after `path.resolve()`,
    // which is the check that actually matters. Reject here too so an
    // obviously-bad ref never even reaches the evidence block.
    if (raw.includes('..') || raw.startsWith('/') || raw.includes('://')) continue;
    if (!isAllowedDocRef(raw)) continue;

    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }

  return out;
}

// ---- changedPathDigest -------------------------------------------------------

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

const MAX_DIGEST_PATHS = 20;

/** Top 20 changed paths by `additions + deletions`, plus a remainder count. */
export function changedPathDigest(files: ChangedFile[]): string {
  if (files.length === 0) return '(no changed files)';

  const sorted = [...files].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  );
  const top = sorted.slice(0, MAX_DIGEST_PATHS);
  const lines = top.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`);

  const remaining = sorted.length - top.length;
  if (remaining > 0) {
    lines.push(`… and ${remaining} more files`);
  }

  return lines.join('\n');
}

// ---- wrapEvidence -------------------------------------------------------------

/**
 * Thin delegation to reviewer-core's `wrapUntrusted`
 * (`reviewer-core/src/prompt.ts:30-34`) — the delimiter-escaping rule is the
 * injection defense (Intent Layer plan risk R-2), so it must have exactly one
 * implementation. `layer-map.md` §3 permits Application → `reviewer-core`,
 * and `wrapUntrusted` is a listed export of reviewer-core's public API
 * (`reviewer-core/CLAUDE.md`). Kept as `wrapEvidence` for callers in this
 * module rather than importing `wrapUntrusted` directly everywhere.
 */
export function wrapEvidence(label: string, content: string): string {
  return wrapUntrusted(label, content);
}
