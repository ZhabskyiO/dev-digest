# Gotchas — `client`

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

_None yet._

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-08-20 — In an RTL test asserting a `MermaidDiagram` rendered (or
  didn't), NEVER assert on `container.querySelector("svg")` alone — every
  `@devdigest/ui`/`vendor/ui/icons.tsx` lucide icon is *also* an `<svg>`, so a
  card frame with a header icon (`GitBranch`, `Boxes`, `ChevronDown`, …)
  always has at least one `svg` in the container regardless of whether the
  diagram rendered. Mock `"mermaid"`'s `render` to resolve a string
  containing a unique marker (e.g. `'<svg data-testid="mock-svg"></svg>'`)
  and assert on `container.querySelector('[data-testid="mock-svg"]')`
  instead — see `SectionCards/ArchitectureCard/ArchitectureCard.test.tsx`
  and `SectionCards/RoutesAndApisCard/RoutesAndApisCard.test.tsx`'s
  diagram-independence test. Also note: an INVALID chart string never
  triggers `MermaidDiagram`'s dynamic `import("mermaid")` at all — the
  `looksLikeMermaid()` regex check runs synchronously in the effect first —
  so an "invalid diagram" assertion needs no `waitFor`/mock, only a VALID one
  does (the dynamic import + `parse`/`render` resolve on a later microtask).

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

- 2026-08-18 — `@devdigest/ui`'s `Markdown` (`react-markdown` + `remark-gfm`,
  no `rehype-raw`) does not silently drop embedded raw HTML in untrusted
  markdown — it renders it as **literal, HTML-escaped text** sitting directly
  in the wrapping `<div class="dd-md">` (not wrapped in a `<p>`, since it's a
  raw mdast HTML node, not a paragraph). So a preview fed
  `<script>alert(1)</script>` produces zero `<script>` elements (confirmed via
  `container.querySelector('script')`) while `screen.getByText(/<script>alert\(1\)<\/script>/)`
  still finds it as visible text — RTL's `getByText` matches it fine even
  though it's a bare text node among sibling `<p>`s, no special query needed.
  Relevant to any component that previews third-party markdown: don't assume
  "no `rehype-raw`" means the raw tag vanishes from the page — it means it
  never becomes a real DOM element or executes, not that it's invisible.

- 2026-08-20 — jsdom implements neither `IntersectionObserver` nor
  `Element.prototype.scrollIntoView` — a component that mounts an
  `IntersectionObserver` for scrollspy (e.g. an "on this page" active-section
  marker) throws `ReferenceError: IntersectionObserver is not defined` the
  moment it renders in a `*.test.tsx`, before any assertion runs. Stub both at
  module scope before the component under test is imported: a minimal
  `class MockIntersectionObserver { observe = vi.fn(); disconnect = vi.fn(); … }`
  assigned to `global.IntersectionObserver`, and `Element.prototype.scrollIntoView
  = vi.fn()`. The mock's `observe` is intentionally a no-op — nothing in jsdom
  ever fires a real intersection callback, so an "active section" driven purely
  by the observer stays stuck at its initial value for the whole test. Design
  the click-to-navigate handler to set the active state directly (not only via
  the observer callback) so "activating a TOC entry moves the marker" is
  provable without simulating scroll — see
  `app/repos/[repoId]/onboarding/_components/OnboardingTourView/_components/TableOfContents/TableOfContents.tsx`'s
  `onActivate` (sets state immediately, then calls `scrollIntoView`) and its
  test file's `vi.spyOn(target, "scrollIntoView")` pattern.

- 2026-08-20 — The literal grep an implementation task's Acceptance section
  hands you (e.g. `grep -rn "\"Onboarding for\|ON THIS PAGE" client/src/app/repos`
  to prove AC-42's catalogue-only rule) matches **comments and test-assertion
  literals**, not just live JSX — a docstring reading `the "Onboarding for
  <repo>" title` or a test's `expect(x).toBe("Onboarding for payments-api")`
  both trip it, even though neither is a hardcoded user-facing string in the
  sense AC-42 cares about. Fix by rephrasing the comment to avoid the exact
  substring, and by building the test's expected value from the imported
  messages fixture (`` `${messages.headingPrefix}payments-api` ``) instead of
  restating the English text — the same "sourced from the catalogue, not
  restated" pattern T9's `LocalSetupCard.test.tsx` already uses for its empty-
  reason assertion. Run the grep against your own owned files before calling
  the task done; don't assume passing tests means the literal verification
  command also passes.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

- 2026-08-05 — A bare `Internal Server Error` / HTTP 500 on **every** route of the
  running dev server (`/`, `/agents`, `/skills`, `/settings/…` all at once) means
  `pnpm build` was run in `client/` while `pnpm dev` was still running. **NEVER
  run `pnpm build` against a live dev server** — both write `client/.next/`, and
  the production artifacts (`.next/BUILD_ID`, `prerender-manifest.json`,
  `export-marker.json`) leave `next dev` reading a tree it did not create. The
  blanket scope is the tell: a code fault breaks the route you touched, not the
  whole app, so do not go hunting in your diff. Fix: stop the dev server,
  `rm -rf client/.next`, restart it. To check a production build safely, do it in
  a throwaway copy or after stopping dev.

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
