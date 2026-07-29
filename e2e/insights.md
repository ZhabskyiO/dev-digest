# Insights — `e2e`

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

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

_None yet._

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

_None yet._

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

_None yet._
