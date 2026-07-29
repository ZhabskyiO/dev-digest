# `@devdigest/api` — Fastify 5 + Drizzle/Postgres

Package manager: **pnpm**. `pnpm dev` (:3001) · `pnpm db:migrate` · `pnpm db:seed` ·
`pnpm test` · `pnpm typecheck`.

## Layout

- `src/modules/<name>/` — self-contained feature plugins (`routes.ts` + service).
  Registered statically in `src/modules/index.ts`: repos · pulls · reviews ·
  agents · repo-intel · polling · settings · workspace
- `src/platform/` — config, DI container, errors, SSE, run-logger, model-router
- `src/adapters/` — ports behind the DI container: llm · github · git · astgrep ·
  codeindex · depgraph · embedder · tokenizer · secrets, plus `mocks.ts`
- `src/db/` — Drizzle schema + migrations · `src/vendor/shared` — canonical Zod contracts

## Conventions

- **Validation is schema-first.** Routes declare Zod `params`/`body` via
  `fastify-type-provider-zod`; invalid input is rejected with 422 *before* the
  handler. Never hand-roll `Schema.parse(req.body)` inside a handler.
- **Plugins register before modules** so encapsulated module plugins inherit
  helmet/cors/rate-limit and the shared error handler.
- New external dependency → add an **adapter behind the DI container**
  (`platform/container.ts`), never import a client directly in a service.
- **Migrations are not applied on boot.** After any schema change run
  `pnpm db:generate` then `pnpm db:migrate`. pgvector is enabled by migration `0000`.
- The DB schema already contains *every* course table; unused ones sit empty.
  An empty table is not a missing migration.

## Non-obvious: what the model actually sees

Prompt assembly is in `reviewer-core/prompt.ts`, fed from
`modules/reviews/run-executor.ts`. Three rules that are easy to break:

- **Repo Intel is ON by default** but only populates once the repo is indexed —
  an unindexed repo degrades *silently* to diff-only.
- **Injection defense is one shared trusted rule** (`INJECTION_GUARD`), not
  keyword scanning. Do not add denylists — a denylist catches one phrasing.
- **Grounding is mandatory.** Findings that don't cite a real diff line are
  dropped and the score is recomputed from survivors; the model's own score is ignored.

## Testing

Split **by filename**: `*.it.test.ts` = DB-backed (testcontainers Postgres, self-skips
without Docker); everything else is hermetic. A test importing `test/helpers/pg.ts`
**must** carry the `.it.test.ts` suffix or the CI split breaks.
Unit: `pnpm exec vitest run --exclude '**/*.it.test.ts'` · Integration:
`pnpm exec vitest run .it.test` · Both: `pnpm test`.

## Do not touch

`clones/` — checkouts of imported repos (git-ignored, includes a copy of this
repo). Never edit; exclude from every search.

## Docs

Request/DI flow, API map, full env table: [README.md](README.md).
[../TESTING.md](../TESTING.md) · [insights.md](insights.md) · [docs/](docs/) · [specs/](specs/).
