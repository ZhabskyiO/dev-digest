# Gotchas — `reviewer-core`

Append-only log of what broke and why: dead ends, dependency and environment
quirks, and error → cause → fix records. Newest at the top.

> **Format:** new entries go under the matching section below as
> `- YYYY-MM-DD — one-line claim`, with `file:line` evidence where it applies.
> Lead hard constraints with **NEVER** / **ALWAYS**.
> **Corrections:** append `└ YYYY-MM-DD correction: …` beneath an entry — never
> rewrite, move, or delete what is already there.
> When an entry starts causing repeated mistakes, promote a one-line version of
> it into [CLAUDE.md](../CLAUDE.md) and leave the full detail here.
> Repo-wide entries belong in the root [insights/](../../insights/) folder instead.
> The other half of this log lives in [INSIGHTS.md](INSIGHTS.md).

## What Doesn't Work

Dead ends and antipatterns — what was tried and failed, and why. **This is the
most-skipped and most-valuable section: if something failed, record it here.**

_None yet._

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

_None yet._
- 2026-08-25 — `OpenRouterProvider.completeStructured` (llm/openrouter.ts) IGNORED the
  per-request `req.timeoutMs` until today: only the constructor-wide SDK timeout (90s)
  applied, and it COMPOUNDS — 3 SDK tries (timeout/5xx/429 backoff) × 3 schema-reprompt
  attempts ≈ 13+ min per reviewPullRequest call before any error surfaces (observed live:
  a 2-call skill eval spun 12+ min with one ESTABLISHED socket and 0% CPU — looks hung,
  is retrying). Fixed: `req.timeoutMs` now becomes a per-request SDK option and caps SDK
  retries at 1; `ReviewInput.llmTimeoutMs` threads it through `reviewPullRequest`; eval
  runs pass `llmTimeoutMs: 45_000, maxRetries: 1` (worst ≈ 3 min). ALWAYS set a
  per-request budget for interactive callers — the constructor default is sized for CI.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._
