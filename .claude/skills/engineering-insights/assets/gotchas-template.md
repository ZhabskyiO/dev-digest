# Gotchas — `MODULE_NAME`

Append-only log of what broke in this package and why: dead ends, dependency and
environment quirks, and error → cause → fix records.

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

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._
