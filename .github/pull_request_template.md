<!--
Delete any section or checklist group that does not apply to this PR.
Everything in HTML comments is invisible in the rendered PR — leave the comments
in place if you like, they cost nothing.
-->

## Description

<!-- What changed, in one or two sentences. -->

Closes #

## Type of change

<!-- Tick everything that applies. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (existing behaviour changes — call it out below)
- [ ] Refactor / internal (no behaviour change)
- [ ] Docs, tooling, or CI only
- [ ] Course lesson — L0__ <!-- see the lesson table in README.md -->

## Motivation and context

<!--
Why is this needed? What problem does it solve, and why this approach over the
obvious alternative? A reviewer who wasn't in your head should be able to judge
the trade-off from this paragraph alone.
-->

## How has this been tested?

<!-- The commands you actually ran, not the ones you meant to run. -->

```sh

```

**Test environment:** Node <!-- nvm use — .nvmrc is 22 --> · pnpm 10 · Docker
<!-- Docker is required for the server-integration and e2e lanes; without it the
integration tests self-skip and prove nothing. -->

## Screenshots

<!-- UI changes only. Before / after if you're changing something that existed. -->

## Which CI will run on this PR

<details>
<summary>Changed path → workflow (all five workflows are path-filtered)</summary>

| Changed path | client | server unit | server integration | reviewer-core | e2e web |
|---|:--:|:--:|:--:|:--:|:--:|
| `client/**` | ✅ | | | | ✅ |
| `server/**` | | ✅ | ✅ | | ✅ |
| `server/src/vendor/shared/**` | | ✅ | ✅ | ✅ | ✅ |
| `reviewer-core/**` | | ✅ | | ✅ | |
| `e2e/**` | | | | | ✅ |
| docs, `scripts/`, root config | — | — | — | — | — |

**Two gaps worth knowing:**

- A PR touching only docs, `scripts/`, or root config runs **no checks at all**.
  A green tick on that PR means nothing ran, not that anything passed — verify
  it by hand.
- `reviewer-core/**` does **not** trigger `e2e-web`, even though the API imports
  reviewer-core's source at runtime. If you changed the engine's behaviour, run
  `./scripts/e2e.sh` locally.

</details>

## Checklist

### Always

- [ ] `pnpm typecheck` and `pnpm test` pass in **every package I touched**
- [ ] I reviewed my own diff before requesting review
- [ ] No secrets in the diff — API keys live in `~/.devdigest/secrets.json`,
      never in `.env`, the database, or a test fixture
- [ ] Nothing from `server/clones/**` or `client/.next/**` is in the diff
- [ ] Commit subject is imperative and unprefixed ("Add cost badge", not
      `feat: add cost badge` — this repo does not use Conventional Commits)

### I changed dependencies

- [ ] Committed the matching `pnpm-lock.yaml` — CI installs with
      `--frozen-lockfile`, so an unsynced lockfile fails the build outright

### I changed the database schema

- [ ] Ran `pnpm db:generate` — **never** hand-wrote the SQL, or drizzle's
      metadata silently desynchronises
- [ ] Committed the migration **and** `meta/NNNN_snapshot.json` **and** the
      `meta/_journal.json` entry
- [ ] Ran `pnpm db:migrate` against a real database
- [ ] Existing rows backfill sensibly (column is nullable, or has a default) —
      migrations are never applied on boot, so a deployed server meets old rows

### I added or moved tests

- [ ] A DB-backed test (anything importing `test/helpers/pg.ts`) is named
      `*.it.test.ts` — otherwise it runs in the **unit** lane, where there is no
      Postgres
- [ ] A hermetic test is **not** named `*.it.test.ts` — otherwise the unit lane
      excludes it and it quietly stops running
- [ ] Server lanes verified locally:
      `pnpm exec vitest run --exclude '**/*.it.test.ts'` (unit) and
      `pnpm exec vitest run .it.test` (integration)

### I changed shared contracts (`vendor/shared`)

- [ ] Edited `server/src/vendor/shared/` (the canonical copy) **and** synced
      `client/src/vendor/shared/` — they are separate physical copies that have
      already drifted, so editing one alone breaks the other package's build

### I changed the client

- [ ] User-facing strings added to `client/messages/en/*.json` — never hardcoded
- [ ] Server data goes through `src/lib/hooks/*` → `src/lib/api.ts`; no direct
      `fetch` in a component

### I changed the server

- [ ] Route input is validated by a Zod schema via `fastify-type-provider-zod`,
      not `Schema.parse(req.body)` inside the handler
- [ ] Any new external dependency sits behind an adapter registered in
      `platform/container.ts`, not imported directly into a service

### I added an e2e flow

- [ ] Uses the next `NN` prefix and stays **read-only** against seeded data — a
      mutating flow breaks every flow after it in the shared browser session
- [ ] Deterministic locators only (`--url`, `--text`, `find role|text|label`);
      never the AI `chat` command

### Docs / scripts / root config only

- [ ] I understand **no CI runs on these paths** and verified the change by hand

### Learnings

- [ ] Anything non-obvious I hit is captured in the relevant module's
      `insights.md` (see the insights protocol in `CLAUDE.md`) — so the next
      person doesn't rediscover it

## Notes for the reviewer

<!--
Anything that would otherwise cost the reviewer time: parts you're unsure about,
deliberate trade-offs, follow-up work you're leaving out on purpose, or a
suggested reading order for a large diff.
-->
