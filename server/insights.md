# Insights — `server`

Append-only log of things learned the hard way in this package: gotchas, dead
ends, and *why* a workaround exists. Newest at the top.

> **Format:** new entries go under the matching section below as
> `- YYYY-MM-DD — one-line claim`, with `file:line` evidence where it applies.
> Lead hard constraints with **NEVER** / **ALWAYS**.
> **Corrections:** append `└ YYYY-MM-DD correction: …` beneath an entry — never
> rewrite, move, or delete what is already there.
> When an entry starts causing repeated mistakes, promote a one-line version of
> it into [CLAUDE.md](CLAUDE.md) and leave the full detail here.
> Repo-wide entries belong in [../insights.md](../insights.md) instead.

## What Works

Approaches and solutions that worked here and are worth reusing.

_None yet._

## What Doesn't Work

Dead ends and antipatterns — what was tried and failed, and why. **This is the
most-skipped and most-valuable section: if something failed, record it here.**

_None yet._

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-07-29 — Cost pricing is two-layered and the layers use **different model-id
  namespaces**. `PriceBook` (`platform/price-book.ts:54`) caches live OpenRouter
  prices keyed by `m.id` — OpenRouter slugs like `z-ai/glm-4.7-flash`. The static
  fallback (`adapters/llm/pricing.ts`) is keyed by bare ids like `gpt-4.1` and
  `claude-haiku-4-5`. So injecting `PriceBook` into the OpenAI/Anthropic adapters
  does **not** give them live pricing — their ids never match the live map and
  every lookup falls through to the static table. ALWAYS add a static entry when
  a non-OpenRouter model prices as `null`; wiring the PriceBook alone will not
  fix it.

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

_None yet._

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

- 2026-07-30 — `TypeError: diagnostics.tracingChannel is not a function` at
  `node_modules/fastify/lib/wrap-thenable.js` when running `pnpm test` means the
  shell is on the default Node 18, not the repo's Node 22. Fastify 5 needs
  `diagnostics_channel.tracingChannel` (Node ≥ 19.9). It surfaces as a *suite
  collection* failure ("0 test") with no mention of Node, so it reads like a
  broken import. Fix: `nvm use` first. Same root cause as the Next.js boot
  failure in [../insights.md](../insights.md), different symptom entirely.

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

_None yet._

---

## Earlier entries

Recorded before the section format existed. Kept verbatim — never migrated,
reworded, or moved.

## 2026-07-28 — server tsc/tests fail on reviewer-core's deps, not server's

**Symptom:** `pnpm install` in `server/` succeeds, but `pnpm typecheck` fails
with `TS2307: Cannot find module '@devdigest/reviewer-core'` (cascading into
`unknown` → `T` errors), or `pnpm test` crashes at module load with
`ERR_MODULE_NOT_FOUND` for `openai`/`zod` — packages `server/package.json`
doesn't even list.

**Cause:** `tsconfig.json` aliases `@devdigest/reviewer-core` →
`../reviewer-core/src/index.ts`, so the server type-checks and runs
reviewer-core's **raw TypeScript source**, not a built package. That source's
own imports (`openai`, `zod`) resolve from `reviewer-core/node_modules` — a
directory `server`'s own `pnpm install` never touches.

**Fix:** `cd ../reviewer-core && pnpm install` (or `pnpm install --frozen-lockfile`
in CI) as a separate step before typechecking or testing `server/`. Every CI
workflow that touches server (`server-unit.yml`, `server-integration.yml`,
`e2e-web.yml`) already does this as an explicit "Install reviewer-core deps"
step — mirror it locally after a clean clone or after deleting
`reviewer-core/node_modules`.
