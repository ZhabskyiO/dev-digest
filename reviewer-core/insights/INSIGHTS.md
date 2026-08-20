# Insights — `reviewer-core`

Append-only log of what works and why it is built this way: reusable approaches,
conventions, and open threads. Newest at the top.

> **Format:** new entries go under the matching section below as
> `- YYYY-MM-DD — one-line claim`, with `file:line` evidence where it applies.
> Lead hard constraints with **NEVER** / **ALWAYS**.
> **Corrections:** append `└ YYYY-MM-DD correction: …` beneath an entry — never
> rewrite, move, or delete what is already there.
> When an entry starts causing repeated mistakes, promote a one-line version of
> it into [CLAUDE.md](../CLAUDE.md) and leave the full detail here.
> Repo-wide entries belong in the root [insights/](../../insights/) folder instead.
> The other half of this log lives in [gotchas.md](gotchas.md).

## What Works

Approaches and solutions that worked here and are worth reusing.

_None yet._

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-08-07 — `PromptAssembly` fields are NOT all populated the same way.
  `callers`/`repo_map`/`pr_description` store the raw pre-render string (no
  section header, no `<untrusted>` wrapper — see `prompt.ts` around
  `assemblePrompt`'s `assembly` object). `intent` is the one exception: it
  stores the FULL rendered `## Stated intent…` section (header +
  `<untrusted>` block + counter-framing paragraph), because unlike the other
  slots its input is a structured object (statement/scope/confidence) with no
  single raw string equivalent — the tiered rendering itself is the only
  meaningful "content". If adding another structured (non-string) optional
  slot, decide explicitly which pattern it needs; don't assume raw-string
  storage is the default.

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

_None yet._
