# `@devdigest/e2e` — browser end-to-end suite

Package manager: **pnpm**. Driven by Vercel **agent-browser** (Rust + CDP CLI).
**No Playwright, no LLM, no API key.**

> ⚠️ Naming: **`specs/` here means agent-browser flow specs**, not feature specs.
> Planned-work documents for this package go in [`docs/`](docs/) instead.

## How to run

- **Hermetic (default choice):** `./scripts/e2e.sh` from the repo root. Spins up
  an isolated stack on alternate ports (Postgres :5433, API :3101, web :3100),
  seeds it, runs the flows, tears it down. Safe alongside your dev stack.
- **Against your own stack:** `npm test` — only correct if your dev DB holds
  *only* the seeded demo repo. Otherwise flows 02/04/05 land on the wrong repo
  and fail. Prefer hermetic.

> ⚠️ **Never `docker compose down -v` to "reset" the dev DB** — it deletes the
> `devdigest_pgdata` volume with every imported repo and review.

## Writing a flow

A flow is `specs/NN-name.flow.json`: `{ name, steps: [{ cmd, label, assert? }] }`.
`run.ts` executes the steps in order against one shared browser session.

- `{BASE}` is substituted with `E2E_BASE_URL` (default `http://localhost:3000`).
- Each `cmd` goes to `agent-browser` verbatim; a non-zero exit fails the flow —
  so **`wait --text` / `wait --url` *are* the assertions**.
- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`.
  **Never use the AI `chat` command** — that is what keeps runs stable and key-free.
- Flows must target **read-only seeded data** (`acme/payments-api`, PR #482, the
  seeded agents) so nothing triggers a model call.

## Conventions

- New flow → next `NN` prefix, and keep it read-only. A flow that mutates state
  breaks the ones after it in the shared session.
- Failure screenshots land in `test-results/` (git-ignored, uploaded by CI).
- Requires the CLI once: `npm i -g agent-browser && agent-browser install`.

## Docs

Flow anatomy, env knobs, coverage table: [README.md](README.md) ·
[../TESTING.md](../TESTING.md) · [insights/INSIGHTS.md](insights/INSIGHTS.md) · [insights/gotchas.md](insights/gotchas.md) · [docs/](docs/).
