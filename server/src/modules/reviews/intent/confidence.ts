import type { IntentConfidence, IntentSource } from '@devdigest/shared';

/**
 * Confidence scoring for a derived PR intent — PURE, deterministic.
 *
 * `computeIntentConfidence`'s signature contains NO model output. This is a
 * deliberate structural guarantee, not a stylistic choice: verbalized LLM
 * confidence is documented as badly calibrated (a companion study found 71% of
 * self-reports were exactly 0.95 with AUROC 0.57), so a small extraction model
 * is the worst possible source for this number. Confidence here is a function
 * of *evidence presence* only — which sources the server actually had in hand
 * before it ever called the model — so there is no code path through which a
 * model could influence its own confidence score.
 */

/** Tier score constants — pin these instead of hardcoding 0.9/0.6/0.3. */
export const TIER_SCORES = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
} as const;

/**
 * Canonical, deduplicated declaration order for `sources` so persisted rows
 * and rendered evidence lines compare cleanly across derivations.
 */
const SOURCE_ORDER: IntentSource[] = [
  'title',
  'branch',
  'commits',
  'paths',
  'prose_body',
  'ticket',
  'ticket_cross_repo',
  'spec_doc',
  'external_url',
];

export function computeIntentConfidence(sources: IntentSource[]): IntentConfidence {
  const present = new Set(sources);
  const ordered = SOURCE_ORDER.filter((s) => present.has(s));

  // `ticket_cross_repo` is deliberately excluded from every condition below —
  // it is inert for confidence (see IntentSource doc in the shared contract).
  // `external_url` is likewise never, on its own or in combination, sufficient
  // to reach `medium` — it only ever accompanies other sources.
  const hasTicket = present.has('ticket');
  const hasSpecDoc = present.has('spec_doc');
  const hasProseBody = present.has('prose_body');

  if (hasTicket && hasSpecDoc) {
    return { tier: 'high', score: TIER_SCORES.high, sources: ordered };
  }
  if (hasTicket || hasSpecDoc || hasProseBody) {
    return { tier: 'medium', score: TIER_SCORES.medium, sources: ordered };
  }
  return { tier: 'low', score: TIER_SCORES.low, sources: ordered };
}
