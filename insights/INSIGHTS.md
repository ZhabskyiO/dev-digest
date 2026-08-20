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

- 2026-08-20 — When ONE user-visible bug spans several agents' owned paths, give
  the whole bug to ONE agent, or verify the composition yourself — per-file
  correctness does not imply the fix works. Splitting a same-path-from-two-repos
  collision in `client/src/components/project-context/AttachmentList` across
  three agents produced three locally-correct, jointly-broken fixes in one
  session: the composite React key shipped while the caller never populated
  `repo_id` (so `itemKey` silently degraded to `":path"` and still collided);
  the row callbacks still reported a bare `path`, so clicking the second of two
  rows acted on the first; and the identity was then discarded again before
  `useDocumentPreview`, which used the tab's active repo. Every one was found by
  an agent reading adjacent code while fixing something else — none by the
  review that scoped the work, because none was visible from inside a single set
  of owned paths. The reusable rule: owned-path isolation makes parallel work
  safe to WRITE, not safe to ASSUME CORRECT; a bug family needs one owner or an
  explicit end-to-end check.

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-08-20 — The root `README.md`'s "What you build in the course" table
  (course-plan line items per lesson) is NEVER updated when a lesson's feature
  actually ships in this lab repo — verified across L01-L05: `git log --
  README.md` shows it untouched since the initial commit except for one
  unrelated CLI-feature commit, and `4031d30` ("feat:(Lab4): add project
  context") made zero changes to it. Project Context and Blast Radius (both
  shipped, both module-level, not new top-level packages) have no root-README
  mention outside that table row. Only a feature that ships as an entirely new
  top-level package (`mcp-server`, L04) gets added elsewhere (package table +
  doc-links line). Do not assume a prior "sibling feature" has a root-README
  treatment worth mirroring just because it shipped — check `git log`/`grep`
  first. For a module-level (non-package) feature, the closest real precedent
  is the short one-paragraph callout used for `repo-intel` right after the
  package table (`README.md:21-24`), not the course-plan table.
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
