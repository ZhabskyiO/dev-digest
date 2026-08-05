/**
 * Approximate token counter for live-typing UI counters (system prompt /
 * skill body editors). Mirrors the server tokenizer's own documented
 * fallback (`server/src/adapters/tokenizer/index.ts`'s `approxTokens`) —
 * the real encoder is js-tiktoken, ~2MB, which a keystroke-driven browser
 * counter can't afford to pull in just for an estimate.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Display-only budget the live counter is shown against (e.g. "412 / 8,000
 * tokens"). Not enforced anywhere — neither `Agent` nor `Skill` has a real
 * per-agent budget field in the contracts — this is a fixed reference point
 * so the counter reads as "how full is a typical context window" rather than
 * a bare, unanchored number.
 */
export const DEFAULT_TOKEN_BUDGET = 8000;
