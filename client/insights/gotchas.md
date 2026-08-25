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

- 2026-08-20 — A drag-reorder helper that receives only the FILTERED/visible
  path list must NEVER append the untouched (hidden/other-repo) refs after
  the reordered block — that tail-append silently relocates every untouched
  ref to the end on any drag while a filter is active, which for an
  attachment-order list is the prompt injection order and the first thing
  dropped when the token budget is exceeded. `reorderRefs`
  (`app/agents/[id]/_components/AgentEditor/_components/ContextTab/helpers.ts`)
  and `reorderDraft` (`app/skills/_components/SkillDetail/_components/ContextTab/helpers.ts`)
  both had this bug; the fix splices the reordered visible refs back into the
  INDEX SLOTS the visible refs originally occupied (`refs.map((r) => shown.has(r.path)
  ? moved[cursor++] : r)` then filter out `undefined`, `noUncheckedIndexedAccess`
  makes `moved[cursor++]` `T | undefined` honestly). The corresponding tests were
  weak positives — one fixture happened to have the hidden ref already last, so
  tail-append and splice-back gave the same answer; always place the untouched
  ref in the MIDDLE of the fixture, never first/last, or the test can't tell
  the two implementations apart.

- 2026-08-20 — `OnboardingTourResponse.job_id` CANNOT be used to key a
  per-failure dismissal (e.g. "re-show the failed notice only for a *new*
  `job_id`") — the server always sends `job_id: null` alongside
  `state: 'failed'` (`server/src/modules/onboarding/service.ts:149`); it is
  only ever non-null while `state === 'generating'`. Every failed response
  looks identical on this field regardless of which attempt produced it, so
  an identity check against it can't tell two different failures apart.
  `OnboardingTourView.tsx`'s `failedDismissed` reset therefore keys off the
  `Regenerate` click itself (`handleRegenerate` resets before
  `generate.mutate()`), not off response identity — this covers the user's
  own retry but not a failure from a regeneration someone else triggered.

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-08-20 — Adding an unconditional `useTranslations("<newNamespace>")` call
  to a shared component (one already rendered by `src/test/smoke.test.tsx`,
  which hand-builds its `NextIntlClientProvider` with only a couple of
  catalogues, e.g. `{ shell: shellMessages }`) does NOT fail that test — Next-
  intl's default `onError` just logs `IntlError: MISSING_MESSAGE` to stderr
  and falls back to rendering the key path as text — but it does pollute test
  output every run. `FileCard.tsx` gained `useTranslations("prReview")` for a
  new `summary` row while the plain-`DiffViewer` smoke test still only
  provides `shell` messages; the hook runs on every render regardless of
  whether `summary` is set, so the warning fires even when the new feature
  isn't exercised. If a future task edits `smoke.test.tsx`'s provider, add the
  now-required namespace there rather than assuming a clean run means no new
  namespace dependency was introduced.

- 2026-08-20 — **NEVER type a `useRef` holding a timeout id as
  `ReturnType<typeof window.setTimeout>`** — it fails `tsc --noEmit` with
  `Type 'number' is not assignable to type 'Timeout'` even though the same
  ref assigned from a bare `setTimeout(...)` call typechecks fine. This
  repo's ambient types resolve `window.setTimeout`'s return type to Node's
  `Timeout` (via `@types/node`'s global augmentation) while the actual call
  `window.setTimeout(...)` still returns a `number` at runtime in the DOM —
  the two disagree. Use the existing codebase convention instead: `const ref
  = useRef<ReturnType<typeof setTimeout> | null>(null)` and call bare
  `setTimeout(...)`/`clearTimeout(...)` (no `window.` prefix), matching
  `components/findings-summary/useHoverCard.ts` and
  `components/app-shell/hooks/useGlobalShortcuts.ts`. Fixed the same way in
  `OnboardingTourView.tsx`'s Share-link reset timer and
  `SectionCards/LocalSetupCard/LocalSetupCard.tsx`'s per-row copy reset
  timer.

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

- 2026-08-20 — `Intl.ListFormat(locale, { type: "conjunction" })` inserts an
  Oxford comma for 3+ English items (`"specs/, docs/, and insights/"`), NOT
  the comma-less `"specs/, docs/ and insights/"` a hand-rolled `joinList`
  might produce. Confirmed via `node -e 'new Intl.ListFormat("en",
  {type:"conjunction"}).format(["specs/","docs/","insights/"])'`. Switching a
  hardcoded English joiner (never hardcode `" and "` in a component — use
  `Intl.ListFormat` sourced from next-intl's `useLocale()`) to
  `Intl.ListFormat` changes the exact rendered punctuation, so any test
  asserting the literal joined string must build its expectation from
  `Intl.ListFormat` too, not restate the old hand-written format — see
  `app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx`.

- 2026-08-20 — `useTranslations()`'s `t()` NEVER throws on a missing key —
  confirmed by rendering `t(`ns.outcome.${unrecognisedValue}`)` in a test: it
  logs `IntlError: MISSING_MESSAGE: Could not resolve …` to `console.error`
  (visible in vitest's stderr) and falls back to next-intl's own
  `getMessageFallback`, not a thrown exception. So a dynamic-key translation
  lookup fed an out-of-union enum value from unvalidated persisted/server data
  degrades safely on its own — the "never throw on unrecognised data" fix
  only needs to guard *plain object/Record lookups* keyed by that same value
  (e.g. `SOME_RECORD[value]` — `undefined.someProp` throws), not the `t()`
  call sitting right next to it. See
  `RunTraceDrawer/_components/TraceBody/TraceBody.tsx`'s `PROJECT_CONTEXT_OUTCOME_TONE`
  lookup (fixed) vs. its neighbouring `t(`trace.projectContext.outcome.${doc.outcome}`)`
  call (left as-is, already safe).

- 2026-08-20 — A planner's "Verify before you return" grep like
  `grep -c "useSomeHook" <File.tsx>` equals 1` can be structurally
  impossible to satisfy: `grep -c` counts matching LINES, and any hook that
  is both imported and called necessarily produces two lines containing its
  identifier (`import { useSomeHook } from "…"` and
  `const x = useSomeHook(…)`), even with a single call site. Don't burn a
  pass trying to make the raw identifier count hit exactly 1 — instead grep
  for the more specific pattern the check is actually protecting (e.g. a
  mutation's `.mutate(` call site, not the hook name) and verify THAT count
  is 1, then report the literal instruction's actual (higher) count with the
  explanation. Real example from T21 (`BriefCard.tsx`): `useGenerateBrief`
  greps to 2 (import + call) no matter what, but `generate\.mutate` — the
  thing AC-43's "exactly one token-spending control" guard actually cares
  about — greps to 1 once the button is written once and referenced from
  both the empty-state and brief-content render branches via a shared JSX
  variable rather than duplicated inline in each branch (which would have
  produced two `generate.mutate()` call sites, silently violating the guard
  while still "working").
- 2026-08-24 — Adding a React Query hook call (`useMutation`/`useQueryClient`) to a
  widely-rendered component (e.g. `FindingsPanel`) breaks EVERY existing test of that
  component with `No QueryClient set, use QueryClientProvider` — those tests render with no
  provider and mock hook MODULES instead. Fix: `vi.mock` the new hook module (e.g.
  `lib/hooks/evals`) in each affected test file, mirroring the existing `lib/hooks/reviews`
  mock. Same failure shape as the 2026-08-20 `useTranslations` entry: a new hook in a shared
  component means updating sibling tests' mocks, not the component.
- 2026-08-24 — The FIRST runtime (value) import from `@devdigest/shared` in a client
  component breaks `next dev` with `Module not found: Can't resolve './contracts/…​.js'`
  — every prior use was `import type` (erased), so webpack had never resolved the
  vendored barrel's ESM-style `.js` specifiers against its `.ts` sources. Typecheck and
  vitest both stay green (tsc and vite map `.js`→`.ts` themselves), so only the running
  app shows it. Fix (in place): `config.resolve.extensionAlias = { ".js": [".ts",
  ".tsx", ".js"] }` in `next.config.mjs`'s `webpack` hook — do not rewrite the shared
  package's import specifiers, the server runs the same files under tsx.

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
