# Gotchas — `e2e`

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

- 2026-07-29 — NEVER treat a local `./scripts/e2e.sh` failure as a regression
  until CI disagrees. Local runs flake: three runs of the same commit gave 5/7,
  6/7 and 7/7, each failing a *different* flow (once `07-settings`, a page the
  change never touched), while CI ran 7/7 on that same commit. The cause is
  structural: `scripts/e2e.sh:148` serves the web app with `next dev`, which
  cold-compiles each route on first visit, whereas `e2e-web.yml:100-101` uses
  `pnpm build` + `pnpm start` with nothing left to compile. On a machine also
  running Docker, Postgres, the API and a browser, a cold compile can exceed the
  60s step timeout (`E2E_STEP_TIMEOUT`) and the step fails with a bare
  `Command failed: agent-browser wait --text …` plus a screenshot that may show
  a plain 404 — which looks exactly like a real routing bug.
  To confirm a suspected regression, re-run and check *which* flow fails: a real
  break fails the same flow every time.

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-08-20 — `agent-browser wait --url <pattern>` does **NOT** support glob
  wildcards in the installed CLI (`agent-browser --version` → `0.27.0`),
  despite both the packaged skill (`agent-browser skills get core --full`) and
  the upstream README documenting `wait --url "**/dashboard"` as a working
  example. Confirmed empirically with `AGENT_BROWSER_DEFAULT_TIMEOUT=6000` set
  to fail fast: a literal substring (`wait --url "repos/abc123/onboarding"`)
  resolves instantly, but every variant containing `*` or `**` — leading,
  trailing, both, with or without an explicit protocol/host prefix — times out
  every time, because `*` is matched as a literal character that never occurs
  in a real URL. Do not reach for a `**/repos/*/onboarding`-style pattern to
  disambiguate a repo-scoped route from an unscoped one with the same suffix
  (e.g. `/repos/:repoId/onboarding` vs plain `/onboarding`) — it will hang the
  flow until the step timeout. Use a plain literal substring instead, and lean
  on a `wait --text` for page-specific content immediately after to rule out
  a false-positive route match; see `e2e/specs/09-onboarding-tour.flow.json`.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._
