# `@devdigest/reviewer-core` — the review engine

Package manager: **pnpm**. `pnpm test` · `pnpm typecheck`.

`server/` type-checks and imports this package's **raw source** at runtime via
a tsconfig path alias — so `pnpm install` must have run here too, independent
of `server`'s own install, or the server fails with `TS2307`/`ERR_MODULE_NOT_FOUND`
on `openai`/`zod`. CI installs this directory separately for that reason.

## The one hard rule

**This package is pure.** No database, no GitHub, no filesystem, no network
client of its own. The only side effect is an LLM call through an **injected**
`LLMProvider`. That purity is what makes it mock-testable — if you find yourself
importing `drizzle`, `fs`, or an SDK here, the code belongs in `server/` instead.

## Pipeline (`src/`)

`prompt.ts` → `assemblePrompt()` + `wrapUntrusted()`/`INJECTION_GUARD`
→ `llm/openrouter.ts` (injected provider)
→ `llm/structured.ts` (Zod → JSON Schema, parse-with-repair)
→ `grounding.ts` (`groundFindings()`)
→ `Review { verdict · score · findings }`

`review/run.ts` orchestrates (single-pass by default) · `review/reduce.ts` is the
map-reduce path · `output/to-review.ts` builds the CI payload.

## Conventions

- **Never emits JS.** `build` is a type-check; the server consumes the TypeScript
  *source* through a path alias (`@devdigest/reviewer-core` → `../reviewer-core/src`),
  via tsx in dev and vitest in tests.
- **Grounding is the mandatory gate** — a finding not citing a real diff line is
  dropped, and the score is recomputed deterministically from survivors. Never
  trust the model's self-reported score.
- **Injection defense is one trusted rule, not text parsing.** `INJECTION_GUARD`
  tells the model untrusted content is data and that "intentional / demo / test /
  don't flag" claims never descope a review. Do not add keyword denylists.
- Contracts (`Review`, `Finding`, `Verdict`) come from `@devdigest/shared` —
  don't redefine them locally.
- `assemblePrompt` accepts optional slots the course lessons fill later —
  `skills` (L02), `specs` (L05), `memory` (L07), `callers`. Omitted slots simply
  render no section; that is expected, not a bug.

## Public API

Everything exported from `src/index.ts`: `assemblePrompt`, `wrapUntrusted`,
`groundFindings`, `groundingSummary`, `toJsonSchema`, `extractJson`,
`parseWithRepair`, `run`, `reduce`. Adding an export is an API decision — keep
the surface deliberate.

## Testing

`npm test` — hermetic vitest with a stubbed `LLMProvider`. No keys, no network.
Covers prompt assembly, the grounding gate, `toReview` selection, and a full `run`.

## Docs

Pipeline diagram + public API: [README.md](README.md) · [../TESTING.md](../TESTING.md)
[insights.md](insights.md) · [docs/](docs/) · [specs/](specs/).
