import type {
  ConventionCandidateDetail,
  ConventionCategory,
  ConventionStatus,
  ExtractedConvention,
} from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import {
  MAX_RULE_LEN,
  MAX_SAMPLE_LINE_CHARS,
  MAX_SAMPLE_LINES,
  MAX_SNIPPET_LEN,
} from './constants.js';

/**
 * Pure helpers for convention extraction — sample formatting, the code-side
 * evidence gate, dedupe keys and row⇄DTO mapping. No I/O, no DB import: the
 * evidence gate is the part of this feature most worth unit-testing, so it must
 * be callable with a plain Map of file contents.
 */

/** Collapse runs of whitespace and trim — the comparison form for code text. */
export function normalizeCode(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Dedupe key for a rule: lowercased, punctuation stripped, whitespace collapsed.
 * Two rules that differ only in phrasing punctuation ("Use `zod` for validation."
 * vs "use zod for validation") collapse to the same key, so the second scan does
 * not re-propose a rule the user already accepted *or rejected*.
 */
export function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render a file for the prompt with a 1-based line-number gutter. The gutter is
 * what makes `evidence_line` checkable: the model can only cite a number it was
 * shown, and `verifyEvidence` then re-checks that number against the real lines.
 */
export function numberLines(lines: string[], maxLines = MAX_SAMPLE_LINES): string {
  return lines
    .slice(0, maxLines)
    .map((line, i) => `${i + 1}\t${line.slice(0, MAX_SAMPLE_LINE_CHARS)}`)
    .join('\n');
}

export interface VerifiedEvidence {
  line: number;
  snippet: string;
}

/**
 * The code-side evidence gate. A proposed convention survives only if the file
 * it cites was actually sampled AND the snippet it quotes really occurs in that
 * file. Nothing here asks the model to check its own work.
 *
 * The cited line is treated as a hint, not as truth: models are routinely a few
 * lines off. When the snippet is not on the cited line we scan the file and
 * return the first line that does contain it, so the UI links to a real
 * location. When the snippet is nowhere in the file, the candidate is dropped.
 */
export function verifyEvidence(
  files: Map<string, string[]>,
  candidate: Pick<ExtractedConvention, 'evidence_path' | 'evidence_line' | 'evidence_snippet'>,
): VerifiedEvidence | null {
  const lines = files.get(candidate.evidence_path);
  if (!lines) return null; // invented (or un-sampled) path

  const needle = normalizeCode(candidate.evidence_snippet);
  if (!needle) return null;

  const cited = candidate.evidence_line;
  const citedText = cited >= 1 && cited <= lines.length ? lines[cited - 1] : undefined;
  if (citedText !== undefined && normalizeCode(citedText).includes(needle)) {
    return { line: cited, snippet: citedText.trim().slice(0, MAX_SNIPPET_LEN) };
  }

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (text !== undefined && normalizeCode(text).includes(needle)) {
      return { line: i + 1, snippet: text.trim().slice(0, MAX_SNIPPET_LEN) };
    }
  }
  return null;
}

export interface VerifiedCandidate {
  category: ConventionCategory;
  rule: string;
  ruleKey: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface VerifyOutcome {
  kept: VerifiedCandidate[];
  /** Proposals whose evidence did not check out, or whose rule was empty. */
  dropped: number;
  /** Proposals already known for this repo, or repeated within one response. */
  duplicates: number;
}

/**
 * Run every proposal through the evidence gate, then through dedupe. `known` is
 * the set of rule keys already stored for this repo in ANY status — a rejected
 * rule is a known rule, which is precisely why rejections stick across scans.
 */
export function verifyCandidates(
  files: Map<string, string[]>,
  proposals: ExtractedConvention[],
  known: ReadonlySet<string>,
): VerifyOutcome {
  const kept: VerifiedCandidate[] = [];
  const seen = new Set(known);
  let dropped = 0;
  let duplicates = 0;

  for (const p of proposals) {
    const rule = p.rule.trim().slice(0, MAX_RULE_LEN);
    if (!rule) {
      dropped += 1;
      continue;
    }
    const evidence = verifyEvidence(files, p);
    if (!evidence) {
      dropped += 1;
      continue;
    }
    const ruleKey = normalizeRule(rule);
    if (!ruleKey || seen.has(ruleKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(ruleKey);
    kept.push({
      category: p.category,
      rule,
      ruleKey,
      evidencePath: p.evidence_path,
      evidenceLine: evidence.line,
      evidenceSnippet: evidence.snippet,
      confidence: Math.min(1, Math.max(0, p.confidence)),
    });
  }

  return { kept, dropped, duplicates };
}

/** Map a persisted conventions row to the public DTO. */
export function toConventionDto(row: ConventionRow): ConventionCandidateDetail {
  return {
    id: row.id,
    rule: row.rule,
    category: row.category as ConventionCategory,
    evidence_path: row.evidencePath ?? '',
    evidence_line: row.evidenceLine,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
    accepted: row.accepted,
    skill_id: row.skillId,
    created_at: row.createdAt.toISOString(),
  };
}
