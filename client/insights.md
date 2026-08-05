# Insights — `client`

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

_None yet._

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-07-30 — **ALWAYS portal a popover/hover-card anchored inside a table row
  to `document.body`** (`createPortal` + `position: fixed` from
  `getBoundingClientRect()`). The list table cards set `overflow: hidden` to clip
  their rounded corners (`app/repos/[repoId]/pulls/styles.ts` → `s.tableCard`), so
  an `position: absolute` panel inside a row is silently cut off at the card
  edge — worst for the last rows, where most of the panel disappears. Working
  example: `pulls/_components/FindingsCell/`, with the flip-above-anchor and
  viewport-clamp maths isolated in its pure `popoverPosition()` helper.
  `vendor/ui/kit/Dropdown.tsx` is still the right source for the *visual*
  treatment (`--shadow-modal`, `ddpop` animation), just not the positioning.

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-07-30 — `@testing-library/user-event` is **not** a dependency here (only
  `@testing-library/react` + `jest-dom`). Reaching for `userEvent.setup()` fails
  at import with `Failed to resolve import "@testing-library/user-event"`. Use
  `fireEvent` from `@testing-library/react` instead — `fireEvent.mouseEnter` /
  `.click` cover hover and click paths, and `findBy*` polls long enough to
  absorb a component's own open/close delay timers without fake timers.
- 2026-08-04 — In a `*.test.tsx`, a relative import of `messages/en/*.json`
  needs **one more `../` than the same file's import of `lib/hooks/*`**, because
  `messages/` sits at the client package root while `lib/` sits inside `src/`.
  E.g. from `src/app/skills/_components/SkillCard/`, `lib/hooks/skills` resolves
  with 4×`../` but `messages/en/skills.json` needs 5×`../` — count directory
  segments from `client/` (the `messages/` parent), not from `src/`. Miscounting
  by one gives Vite's `Failed to resolve import "…/messages/en/x.json"` with no
  hint about the off-by-one; the existing `AgentCard.test.tsx` /
  `AgentEditor.test.tsx` pairs are the ground truth for the right depth at a
  given nesting level if in doubt.
- 2026-08-04 — `tsconfig.json` has `noUncheckedIndexedAccess: true`, so any
  `array[i]` (including `arr[i]` inside a `.forEach`/manual loop, not just
  `.find()`) types as `T | undefined`, not `T` — assigning it straight into a
  `T`-typed slot fails `tsc --noEmit` with "Type 'string | undefined' is not
  assignable to type 'string'" even though the index is provably in range.
  Guard with an explicit `!== undefined` check (or `?? fallback`) before the
  assignment; `.at()` has the same `| undefined` return so it doesn't dodge
  this. Easy to miss because plain array destructuring/`.map()` callbacks
  don't trigger it — only direct indexed access does.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

_None yet._

---

## Earlier entries

Recorded before the section format existed. Kept verbatim — never migrated,
reworded, or moved.

## 2026-07-27 — `pnpm start` fails with "Could not find a production build"

**Symptom:** `pnpm start` exits with
`Could not find a production build in the '.next' directory.`

**Cause:** `start` maps to `next start`, which serves an existing production
build — it does not create one. Reaching for `start` out of habit (npm projects
where `start` means "run it") hits this every time.

**Fix:** use `pnpm dev` for development. Only use `pnpm build && pnpm start`
when you specifically want to exercise the production build locally.
