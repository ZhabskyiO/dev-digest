import { z } from 'zod';
import { Severity, Verdict } from './findings.js';
import { BlastStatus, BlastRadiusResult } from './blast.js';
import { PrIntentDetail } from './intent.js';

/**
 * PR Brief envelope — `GET /pulls/:id/brief` / `POST /pulls/:id/brief/generate`.
 *
 * A new leaf file on purpose: `PrBriefDetail` needs `PrIntentDetail`
 * (contracts/intent.ts), which already imports `Intent` from contracts/brief.ts.
 * Putting the envelope in brief.ts would create a circular ESM import between
 * two modules of top-level Zod `const`s — a real TDZ hazard at runtime, not a
 * style preference. This file imports from brief.ts (indirectly, via intent.ts),
 * intent.ts, blast.ts and findings.ts and has no cycle back to any of them.
 *
 * NOTE: no field here carries a Zod default value. `PrBriefDetail` doubles as
 * a route response schema, and a default there rewrites what actually goes on
 * the wire (same rule as contracts/blast.ts).
 */

/** One "look here" pointer surfaced alongside the brief — file/line + why. */
export const ReviewFocusEntry = z.object({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
  severity: Severity,
  /** The finding this focus entry was derived from, when there is one. */
  finding_id: z.string().nullish(),
});
export type ReviewFocusEntry = z.infer<typeof ReviewFocusEntry>;

/** Read-time rollup of the PR's review verdict(s) — composed, never persisted. */
export const BriefVerdictSummary = z.object({
  verdict: Verdict,
  findings: z.number().int(),
  blockers: z.number().int(),
  /** Null when no score is available yet. */
  score: z.number().nullable(),
});
export type BriefVerdictSummary = z.infer<typeof BriefVerdictSummary>;

/**
 * The persisted `pr_brief.json` blob — COUNTS ONLY.
 *
 * Deliberately just `{ summarized_files, changed_files }`. It must NEVER gain
 * `status`, `reason`, `blast`, `verdict_summary` or `review_focus`: those live
 * on `PrBriefDetail` (the wire shape) and are resolved live at read time from
 * `container.blast` and from `reviews`/`findings`/`pr_files` — never snapshotted
 * here. Persisting a blast payload on this record is exactly what AC-14 checks
 * for the absence of; widening this schema to carry one is a regression, not a
 * feature.
 */
export const PrBriefRecord = z.object({
  summarized_files: z.number().int(),
  changed_files: z.number().int(),
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;

/**
 * The wire shape of a PR brief — `GET /pulls/:id/brief` and
 * `POST /pulls/:id/brief/generate`. Mixes persisted fields (`pr_id`, `head_sha`,
 * `cost_usd`, `tokens_in`, `tokens_out`, `generated_at`, `summarized_files`,
 * `changed_files`, and `intent` read back from `pr_intent`) with read-time
 * fields resolved fresh on every request (`status`, `reason`, `blast`,
 * `verdict_summary`, `review_focus`) — see the plan's Persisted-vs-read-time
 * table for the authoritative split.
 */
export const PrBriefDetail = z.object({
  pr_id: z.string(),
  head_sha: z.string(),
  status: BlastStatus,
  reason: z.string().nullable(),
  intent: PrIntentDetail.nullable(),
  blast: BlastRadiusResult.nullable(),
  verdict_summary: BriefVerdictSummary.nullable(),
  review_focus: z.array(ReviewFocusEntry),
  /** Null when the model has no known price — renders as `—`, never `$0.00`. */
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  generated_at: z.string(),
  summarized_files: z.number().int(),
  changed_files: z.number().int(),
});
export type PrBriefDetail = z.infer<typeof PrBriefDetail>;
