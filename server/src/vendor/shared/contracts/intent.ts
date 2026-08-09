import { z } from 'zod';
import { Intent } from './brief.js';

/**
 * Intent Layer (L03) — provenance around the `Intent` object.
 *
 * `Intent` itself (contracts/brief.ts) stays exactly as it is: the three fields
 * a model may produce. Everything here is what the SERVER knows about that
 * production — which evidence it had, how much to trust it, what it cost.
 *
 * These compose `Intent` rather than widening it, so `PrBrief.intent` and
 * `PrIntentRecord` are untouched.
 */

export const IntentConfidenceTier = z.enum(['high', 'medium', 'low']);
export type IntentConfidenceTier = z.infer<typeof IntentConfidenceTier>;

/**
 * Which evidence a derivation actually had in hand. `title`/`branch`/`commits`/
 * `paths` are always present (they come from columns that are never null);
 * the rest are earned.
 *
 * `ticket_cross_repo` is recorded but deliberately INERT for confidence — an
 * `owner/repo#100` reference is captured and never fetched, so it is evidence
 * that a ticket exists, not evidence of what it says.
 */
export const IntentSource = z.enum([
  'title',
  'branch',
  'commits',
  'paths',
  'prose_body',
  'ticket',
  'ticket_cross_repo',
  'spec_doc',
  'external_url',
]);
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * Confidence in a derived intent.
 *
 * NEVER model-reported. Computed server-side by `computeIntentConfidence()`
 * from `sources` alone — verbalized LLM confidence is documented as badly
 * calibrated, and a small extraction model is the worst case for it. There is
 * deliberately no path for a model to write this object.
 */
export const IntentConfidence = z.object({
  tier: IntentConfidenceTier,
  score: z.number().min(0).max(1),
  sources: z.array(IntentSource),
});
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** A persisted intent for one PR, with its provenance. Served by GET /pulls/:id/intent. */
export const PrIntentDetail = Intent.extend({
  pr_id: z.string(),
  /** The commit this intent describes. A different head ⇒ the intent is stale. */
  head_sha: z.string(),
  confidence: IntentConfidence,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Null when the model has no known price — renders as `—`, never `$0.00`. */
  cost_usd: z.number().nullable(),
  derived_at: z.string(),
});
export type PrIntentDetail = z.infer<typeof PrIntentDetail>;
