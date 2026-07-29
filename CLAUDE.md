# DevDigest

Local-first AI pull-request review. Four **standalone packages — not a monorepo
workspace**: each has its own `package.json` and lockfile. Cross-package imports
resolve through tsconfig path aliases, never through published modules or
`node_modules`.

## Map

| Dir              | Package                    | Stack                        | Port |
|------------------|----------------------------|------------------------------|------|
| `server/`        | `@devdigest/api`           | Fastify 5 + Drizzle/pgvector | 3001 |
| `client/`        | `@devdigest/web`           | Next.js 15 App Router        | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | pure engine, no I/O          | —    |
| `e2e/`           | `@devdigest/e2e`           | agent-browser flows          | —    |

All four use **pnpm** (own lockfile each — still no workspace linking them).

Each dir has its own `CLAUDE.md`; read it before working in that dir.

## Commands

- Whole stack: `./scripts/dev.sh` (Postgres in Docker + API + web, seeded)
- Browser e2e: `./scripts/e2e.sh` (isolated stack on alt ports — never your dev DB)
- **Node ≥22 required.** `.nvmrc` = 22; run `nvm use` first or Next.js refuses to boot.

## Gotchas

- **Migrations never run on boot** — `cd server && pnpm db:migrate`. The symptom
  of forgetting is `relation ... does not exist` from the API.
- **`src/vendor/` is vendored source, not dependencies.** `@devdigest/shared`
  (Zod contracts) and `@devdigest/ui` live there in both client and server. The
  canonical copy of `shared` is `server/src/vendor/shared`.
- **Never `docker compose down -v`.** `-v` drops the `devdigest_pgdata` volume
  along with every repo and review imported so far. Use `down` without `-v`.
- Port 5432 conflicts usually mean a *native* Postgres is running, not another
  container — check `/Library/LaunchDaemons/` before blaming Docker.
- Secrets live in `~/.devdigest/secrets.json` (mode `0600`), **not** in `.env`
  or the DB. `AppConfig` deliberately excludes them.

## Do not touch

- **`server/clones/**`** — checkouts of imported target repos, including a full
  copy of *this* repo. Never edit, and always exclude it from search: it silently
  doubles every grep hit and every glob match.
- `client/.next/**` · lockfiles (`pnpm-lock.yaml`, `package-lock.json`)

## Insights protocol

Before working in a module, read its `insights.md` and the root one — treat
entries as high-confidence unless the code contradicts them. At the end of a
task run `/engineering-insights` to capture what was learned. Writing nothing is
correct when nothing new or important came up; never duplicate, overwrite, or
delete an existing entry.

## Docs

Architecture and per-package diagrams: [README.md](README.md).
Test strategy across all suites: [TESTING.md](TESTING.md).
Reviewer system prompts: [docs/agent-prompts/](docs/agent-prompts/).
Hard-won debugging notes: [insights.md](insights.md).

Convention for every package: `README.md` = human explanation ·
`docs/` = durable reference · `specs/` = work not yet built ·
`insights.md` = append-only log of things learned the hard way.
When an insight starts causing repeat mistakes, promote it into the relevant
`CLAUDE.md` and leave the detail behind in `insights.md`.
