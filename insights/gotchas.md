# Gotchas — repo-wide

Append-only log of what broke and why: dead ends, dependency and environment
quirks, and error → cause → fix records. Newest at the top.

> **Format:** new entries go under the matching section below as
> `- YYYY-MM-DD — one-line claim`, with `file:line` evidence where it applies.
> Lead hard constraints with **NEVER** / **ALWAYS**.
> **Corrections:** append `└ YYYY-MM-DD correction: …` beneath an entry — never
> rewrite, move, or delete what is already there.
> When an entry starts causing repeated mistakes, promote a one-line version of
> it into [CLAUDE.md](../CLAUDE.md) and leave the full detail here.
> Package-specific entries belong in that package's own `insights/` folder.
> The other half of this log lives in [INSIGHTS.md](INSIGHTS.md).

## What Doesn't Work

Dead ends and antipatterns — what was tried and failed, and why. **This is the
most-skipped and most-valuable section: if something failed, record it here.**

_None yet._

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-07-30 — NEVER read an empty `gh pr view --json statusCheckRollup` as "no
  CI ran". It is also `[]` for the first minute or two after a push, while the
  runs sit **queued** — GitHub only populates the rollup once a run starts. The
  open-pull-request skill says an empty rollup means the change hit only
  path-filtered-out paths; that is one cause of two, and acting on it reports a
  green PR as unverified (or vice versa). To wait correctly, poll `gh run list`
  filtered to the head sha instead:
  `gh run list --branch <b> --json headSha,status,conclusion` and loop until no
  run for that sha has `status != "completed"`. An until-loop over the rollup
  exits instantly on the empty array and tells you nothing.
- 2026-08-14 — Under tsx's in-process loader (`import { register } from
  'tsx/esm/api'`, used by `mcp-server/bin/devdigest.mjs`), the `.js` → `.ts`
  specifier remap applies to STATIC imports only. A **dynamic** `await
  import('../http/client.js')` from a `.ts` module dies with
  `ERR_MODULE_NOT_FOUND … client.js imported from …/cli/index.ts`, even though
  the identical static import resolves. Do not "fix" it by importing
  `'../http/client.ts'` — `tsc` then fails without
  `allowImportingTsExtensions`. Restructure so the import can stay static; if
  the dynamic import existed to control module-load ORDER (e.g. setting an env
  var before a config module snapshots it), make the config read lazily
  (a getter) instead — `mcp-server/src/config.ts:17` does this so `--api-url`
  works with static imports.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._

---

## Earlier entries

Recorded before the section format existed. Kept verbatim — never migrated,
reworded, or moved.

## 2026-07-28 — reviewer-core and e2e were on npm, unified to pnpm

**Symptom (historical):** `reviewer-core/` and `e2e/` had `package-lock.json`
while `client/` and `server/` had `pnpm-lock.yaml` — no comment, README, or
commit explained the split (repo started from a single "Initial commit").

**Cause:** best guess from the evidence, not a documented decision. Both
packages are trivial leaves — `e2e` has zero runtime deps, `reviewer-core` has
two (`openai`, `zod`) — so neither needed anything pnpm offers, and nothing
forces consistency since these are four independent packages, not a workspace.
CI had already frozen the split in per-package `npm ci` steps, which is why it
survived unnoticed.

**Fix:** converted both to pnpm (deleted `package-lock.json`, generated
`pnpm-lock.yaml`, added `.npmrc` to `reviewer-core` matching client/server's
`node-linker=hoisted`) and updated every CI workflow
(`reviewer-core.yml`, `server-unit.yml`, `server-integration.yml`,
`e2e-web.yml`) plus `TESTING.md`. All four packages are pnpm now — see
[server/insights/gotchas.md](../server/insights/gotchas.md) for the still-real gotcha this did
**not** remove (installing reviewer-core's deps is still a separate step).

## 2026-07-27 — Port 5432 taken by a *native* Postgres, not a container

**Symptom:** `docker compose up` fails with
`Ports are not available: ... bind: address already in use` on 5432, while
`docker ps` shows no Postgres container and `lsof -iTCP:5432` returns nothing.

**Cause:** an EnterpriseDB PostgreSQL 16 install running as a system launch
daemon (`/Library/PostgreSQL/16/bin/postgres`, loaded from
`/Library/LaunchDaemons/postgresql-16.plist`). Plain `lsof` can't see it because
the socket is owned by another user — it needs `sudo`.

**Fix:** `sudo launchctl unload /Library/LaunchDaemons/postgresql-16.plist`
(also disables auto-start on reboot). Diagnose with
`ps aux | grep postgres` rather than `lsof`, which reports nothing useful here.
The alternative is remapping the host port in `docker-compose.yml`, which then
requires updating `DATABASE_URL` everywhere.

## 2026-07-27 — Next.js won't boot on the default Node

**Symptom:** `pnpm dev` in `client/` exits immediately with
`You are using Node.js 18.16.0. For Next.js, Node.js version
"^18.18.0 || ^19.8.0 || >= 20.0.0" is required.`

**Cause:** the shell's default nvm version is older than the repo's `.nvmrc` (22).

**Fix:** `nvm use` before any client/server command. Worth wiring an automatic
`nvm use` on `cd` into the shell profile — this will otherwise recur constantly.
