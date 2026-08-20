# Insights — repo-wide

Append-only log of what works and why it is built this way: reusable approaches,
conventions, and open threads. Newest at the top.

> **Format:** new entries go under the matching section below as
> `- YYYY-MM-DD — one-line claim`, with `file:line` evidence where it applies.
> Lead hard constraints with **NEVER** / **ALWAYS**.
> **Corrections:** append `└ YYYY-MM-DD correction: …` beneath an entry — never
> rewrite, move, or delete what is already there.
> When an entry starts causing repeated mistakes, promote a one-line version of
> it into [CLAUDE.md](../CLAUDE.md) and leave the full detail here.
> Package-specific entries belong in that package's own `insights/` folder.
> The other half of this log lives in [gotchas.md](gotchas.md).

## What Works

Approaches and solutions that worked here and are worth reusing.

_None yet._

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-07-28 — `skills-lock.json` tracks only **vendored** third-party skills
  (`sourceType: github` + upstream path + sha256 for drift detection).
  Locally-authored skills (`security`, `mermaid-diagram`, `react-best-practices`,
  `react-testing-library`, `engineering-insights`) are deliberately absent —
  NEVER add one when creating a skill. The file is maintained by an external
  tool: nothing in this repo reads or writes it, and it already drifts both ways
  (`architecture-patterns` and `github-workflow-automation` are listed but not
  present in `.claude/skills/`).

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

_None yet._
