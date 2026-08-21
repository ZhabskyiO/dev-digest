# Insights — `client`

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

- 2026-08-18 — To test a component whose behavior depends on a mutation's
  response feeding back into a later render (e.g. a running total computed
  from `useQuery` data that a sibling `useMutation`'s `onSuccess` updates via
  `qc.setQueryData`), mock `lib/api`'s `api.get`/`api.put` and wrap the render
  in a real `QueryClientProvider`, instead of `vi.mock`-ing the hooks module
  (the `SkillsTab.test.tsx` pattern, where `mutate` is a bare `vi.fn()`). A
  mocked hooks module gives you no re-render when the "mutation" resolves —
  the derived value the component reads next render never changes because the
  mock function isn't backed by React Query's cache. Wiring a tiny in-memory
  "server" behind the real `api.get`/`api.put` (module-level mutable state the
  mock reads/writes) makes checkbox-toggle → PUT → cache update → re-render
  work exactly as it does against the real API, with a fresh `new
  QueryClient()` per `render()` to avoid cross-test cache bleed. See
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`.

- 2026-08-20 — To reseed a local draft (`useState`) from React Query DATA on
  first load without ever clobbering unsaved in-progress edits on a later
  background refetch, gate the reset with a ref tracking "have I already
  seeded THIS entity's id" — NOT with `!isDirty` alone. `!isDirty` alone
  deadlocks on the very FIRST load whenever the persisted set is non-empty:
  before the draft has ever been seeded it trivially differs from the
  just-loaded server data, so `isDirty` is already true and the guard blocks
  the very seed it exists to allow through. The ref lets the FIRST load for a
  given id always seed (ignoring `isDirty`), while every LATER refetch of the
  SAME id only reseeds when `!isDirty`. See
  `client/src/app/skills/_components/SkillDetail/_components/ContextTab/ContextTab.tsx`'s
  `seededForSkillRef` effect, and its test's "background refetch while dirty"
  case for how to exercise it: extend the test's `renderTab()` helper to
  return the `QueryClient` it built so the test can call
  `qc.invalidateQueries({ queryKey: [...] })` directly against the exact
  instance the tree is wired to, simulating a refetch without a real mutation.

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-08-20 — A `messages/en/<ns>.json` catalogue file's own top level is
  UNPREFIXED — `brief.json`'s top level is `empty`, `stale`, `verdict`, … not
  `brief.empty` — because `src/i18n/request.ts:16-25`'s `loadMessages` walks
  every `messages/<locale>/*.json`, keys the merged tree by filename-minus-
  extension, and nests each file's own JSON under that key; a component then
  does `useTranslations("brief")` once and calls `t("empty.title")`, never
  `t("brief.empty.title")`. Confirmed against the existing consumers
  (`IntentCard.tsx:37`, `BlastCard.tsx:32` both call
  `useTranslations("brief")`). A NEW catalogue file needs **no registration
  anywhere** — dropping it in `messages/en/` is sufficient; only a NEW locale
  directory would need wiring.

- 2026-08-20 — In `SmartDiffViewer.tsx`, `openPaths` (`Record<string, boolean>
  | null`) is written by three separate effects: the initial seed-from-server
  effect, `jumpToFirstFinding`'s badge-click handler, and (added for AC-26) a
  URL-driven `target` effect. ALWAYS write it with the functional
  `setOpenPaths((prev) => ({ ...prev, [path]: true }))` form, never a direct
  object, even from an effect that thinks it's "the first write" — two of
  these effects can fire in the same commit (e.g. smart-diff data arriving
  while a `?file=`/`?line=` target is already in the URL), and only the
  functional form is guaranteed to see the other effect's pending update
  rather than clobbering it. `{...null}` is valid JS (evaluates to `{}`), so
  the functional form works safely even before the seed effect has run.

- 2026-08-20 — `AttachmentList`'s composite `${repo_id}:${path}` row key
  (`AttachmentList.tsx:96-98`) only actually disambiguates two same-path rows
  if the CALLER populates `AttachmentListItem.repo_id` — it's optional and
  silently falls back to `""` when omitted, collapsing straight back to the
  `path`-only collision the composite key exists to prevent. The agent
  Context tab's cross-repo "Attached documents" list (`attachedItems`, built
  from `directDocs`, which spans every repo the agent has ever attached
  from — see the file's own header comment) needed `repo_id: d.repo_id`
  added to the mapped item explicitly; it is not inferred from anywhere else.
  Separately, and NOT fixed by the composite key: `onToggle`/`onPreview`
  still report only `path` back to the caller, never `repo_id` — a caller
  mutating state from that callback (e.g. `detach()`) genuinely cannot know
  WHICH of two same-path rows was clicked. The practical fix there is to
  resolve the matching doc from the caller's OWN source array by path (first
  match wins) rather than trying to disambiguate the click itself — see
  `app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx`'s
  `detach()`.
  └ 2026-08-20 correction: "first match wins" was itself a bug, not a fix — it
    silently acts on the FIRST row in list order regardless of which row was
    actually clicked (a wrong-row action, not merely a missing disambiguation).
    The real fix threads identity through the callback itself:
    `AttachmentList`'s `onToggle`/`onPreview` now report the FULL clicked
    `AttachmentListItem` (`repo_id` + `path`), not a bare path string —
    `AttachmentList.tsx`'s `RowContent` calls `onToggle(item)`/`onPreview(item)`
    instead of `onToggle(item.path)`. `detach()` then filters `directRefs` by
    `r.repo_id === item.repo_id && r.path === item.path` directly, with no
    `directDocs.find()` resolution step at all. The skill ContextTab's
    `toggle()` was updated to the same signature for consistency even though
    its lists are always single-repo-scoped (`attachedRefs`/`browseItems`
    filtered to `selectedRepoId`), so it has no reachable version of this bug.
    One residual gap NOT fixed (flagged, not closed): `onPreview`'s new full
    item is still reduced back to a bare path before reaching
    `useDocumentPreview(repoId, path)`, which is scoped to the ACTIVE repo
    (component state), not `item.repo_id` — previewing a same-path row from a
    non-active repo still shows the active repo's content at that path.
    Fixing that needs the preview hook (`lib/hooks/`) to accept a repo id per
    call, out of a UI-only task's owned paths.
  └ 2026-08-20 correction: closed, and it was NOT a hook change after all.
    `useDocumentPreview(repoId, path)` (`lib/hooks/project-context.ts:54-66`)
    already accepted `repoId` as a normal per-call argument and already keyed
    its query on `["project-context-preview", repoId, path]` — the bug was
    entirely in the TWO CALL SITES passing the tab's active-repo state
    instead of the clicked row's own `item.repo_id`. Fix: both ContextTabs now
    track `previewTarget: { repoId, path }` (not a bare path) set from
    `item.repo_id ?? activeRepo.id` in every `onPreview` handler, and pass
    `previewTarget?.repoId`/`previewTarget?.path` straight into the existing
    hook signature unchanged. Lesson for next time: before assuming a fix
    needs a hook/contract change, check whether the hook already accepts the
    right parameter and the bug is only in what the CALLER passes it — this
    one looked like an out-of-scope hook change for two passes running before
    someone actually read the hook's existing signature.

- 2026-08-20 — When a semantic heading (`<h2>`, etc.) wraps a toggle/disclosure
  `<button>` that carries its OWN `aria-label` (e.g. a collapse control
  labelled `"Toggle {section} section"`), give the heading itself an explicit
  `aria-label` too — otherwise its accessible name is computed from the
  button's aria-label (accname's "name from content" recurses into the
  interactive child and uses ITS name, not its visible text), not from the
  heading's visible span text. Without the heading's own `aria-label`,
  `getByRole("heading", { name: "Architecture overview" })` fails to match
  even though "Architecture overview" is plainly visible on screen — the
  heading's computed name is actually `"Toggle Architecture overview
  section"`. Fixed in `SectionCards/SectionCard/SectionCard.tsx`:
  `<h2 aria-label={heading}><button aria-label={t("collapseSection", …)}>…`
  pins the h2's name to just the section title, independent of the button.

- 2026-08-20 — A component folder MUST carry its own `index.ts` re-export
  (`export { Thing } from "./Thing";`) the moment a SIBLING component folder
  imports it as `"../Thing"` rather than `"../Thing/Thing"` — Vite/vitest's
  resolver treats a bare directory specifier as a package import and needs
  that `index.ts` as its entry point; without it, `"../Thing"` fails at
  transform time with `Failed to resolve import "../Thing"` even though the
  file `Thing/Thing.tsx` plainly exists. `ConventionCard/index.ts` and
  `SkillCard/index.ts` already do this; six new sibling card folders under
  `onboarding/.../SectionCards/*Card/` needed the same `index.ts` added
  before their `"../SectionCard"` imports (and `SectionCards/index.ts`'s own
  barrel re-exports) would resolve. When scaffolding a new colocated
  component folder that another folder at the same level will import,
  add its `index.ts` in the same pass — don't wait for the resolver error.

- 2026-08-19 — A tab bar's `?tab=` allowlist must be DERIVED from the tab
  array, never restated. `SkillDetail/constants.ts` does it right
  (`export const TAB_KEYS = TABS.map((t) => t.key)`); `agents/[id]/page.tsx`
  had a hand-written `VALID_TABS = ["config","skills","stats"]` that was not
  updated when the Context tab was added, so clicking Context set
  `?tab=context`, failed the allowlist on the next render, and bounced the
  user straight back to Config — a tab that looks wired up but silently
  refuses to open. Same trap in the TEST layer: a `vi.mock` of the detail
  module that restates `TAB_KEYS` as a literal goes stale the same way
  (`SkillsListView.test.tsx` was missing `context`, so it would have passed
  against a broken tab bar). Import the real constants into the mock with
  `const c = await vi.hoisted(async () => await import("./…/constants"))` and
  spread those, so the mock cannot drift from production.

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

- 2026-08-19 — `components/project-context/AttachmentList` renders `DriftBadge`
  per row but never forwards a click handler for it (no `onDriftClick` prop) —
  it only supports whole-row toggle/move/preview. A screen that must make a
  drifted row's marker clickable (AC-37/AC-38's confirm/detail flow) without
  editing that shared component (out of scope for a UI-owned-paths task) has
  to render its own small supplementary list of drifted items *outside*
  `AttachmentList` — a plain `path + <DriftBadge onClick=…/>` row — rather
  than trying to make the checkbox row itself interactive. See
  `app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx`'s
  "Attached documents" section (the checkbox list from `AttachmentList`, plus
  a separate drifted-paths list right below it feeding the same drift-detail
  panel) and the equivalent in `app/skills/_components/SkillDetail/_components
  /ContextTab/ContextTab.tsx`. Also useful there: `EffectiveProjectContextDoc
  .source` (`'agent' | 'skill'`) tells you which owner a drift/confirm call
  needs (`ownerId = source === 'agent' ? agent.id : d.skill_id`) — one click
  handler covers both a directly-attached and an inherited-from-skill row.

- 2026-08-20 — **NEVER assume a server body handed to a client-side algorithm
  is capped just because some OTHER endpoint on the same resource caps it.**
  `DriftCompare/helpers.ts`'s O(n·m) LCS `diffLines` justified its full-matrix
  allocation on "bodies are capped at the server's preview limit" — true only
  for the *preview* endpoint (`projectContextPreviewChars`, 16k chars, applied
  in `service.ts:239`). The *drift* endpoint's `previous`/`current` are
  returned uncapped, and discovery allows files up to
  `PROJECT_CONTEXT_MAX_FILE_BYTES` (1 MiB) — a drifted large doc allocates a
  matrix in the hundreds of millions of cells during render. Fix pattern: the
  pure diff helper owns an explicit, named budget (`DIFF_MAX_LINES`) and caps
  both sides *before* building the matrix, returning `{ lines, truncated }`
  instead of a bare array so the component can never silently render a
  partial diff as if it were complete — it must show a truncation notice
  (`context.json`'s `drift.detail.truncatedNote`). When adding a new
  algorithm over a document body sourced from `lib/hooks/project-context.ts`,
  check which cap (if any) applies to *that specific* route in
  `server/src/modules/project-context/service.ts`, not just the feature as a
  whole — the caps are per-endpoint, not per-resource.

- 2026-08-21 — `BriefCard.tsx` has exactly ONE token-spending control (AC-43),
  held in a single `generateButton` node and rendered at ONE of three sites:
  the empty state (`Generate brief`, `mutate({ force: false })`), the stale
  notice (`Regenerate brief`, `mutate({ force: true })` — AC-12 wants the
  regenerate action IN the notice), or the controls row (same Regenerate,
  when current). NEVER add a second button wired to `useGenerateBrief` — the
  test asserts `getAllByRole('button', { name: /regenerate brief/i })` has
  length 1. `force` is what makes regeneration actually refresh: without
  `?force=true` the server returns the existing brief for the current head.

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

- 2026-08-18 — The repo-level Project Context page
  (`app/repos/[repoId]/context/`) cannot wire a real drift-detail/confirm flow
  (AC-37, AC-38) for a document row, and this is a data-shape gap, not a
  missed wiring step. `GET /repos/:id/context/documents` only ever returns
  `ProjectContextDocument.used_by_agents: number` (a count) plus an aggregate
  `drift: boolean` — no attachment owner ids. But `useDocumentDrift` /
  `useConfirmDrift` (`lib/hooks/project-context.ts`) — and the server routes
  they call, and `service.ts`'s `drift()`/`confirm()` (both already fixed,
  `server/src/modules/project-context/service.ts:378-421`) — require a
  concrete `{ ownerKind: 'agent'|'skill', ownerId }` (`AttachmentOwnerRef`),
  and 404 (`getAttachment` throws `NotFoundError`) without one. There is no
  client-side way to recover a real owner id from this page: `useAgents()`
  returns the whole workspace's agents with no repo scope and no attachment
  info, so resolving one would mean an N+1 fan-out trying each agent's
  `useDocumentDrift` until one didn't 404 — a bad, over-engineered fetch
  pattern for a "thin" browse page. T13 (agent Context tab) and T14 (skill
  section) DO have a natural owner (their own id) and are where AC-37/AC-38's
  confirm flow is actually implementable; T12 renders `DriftBadge` as an
  informational, non-interactive marker only (satisfies AC-36's "wherever it
  is listed"). Fixing this for real needs either a contract change (T1's
  `ProjectContextDocument` growing an `attached_by: {kind, id}[]` list) or a
  new owner-less repo+path drift/confirm route — both out of a single UI
  task's scope; flag for the planner before assigning AC-37/AC-38 to a
  repo-level document list task again.
  └ 2026-08-19 resolved: the backend contract gap is closed. `ProjectContextDocument`
    now carries `drifted_for: ProjectContextDriftOwner[]` (`{owner_kind, owner_id,
    owner_name}`), computed server-side per document in the list query — no N+1,
    no client-side owner-id guessing needed. `app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx`
    now renders one clickable chip per drifted owner (by `owner_name`) that opens
    `DriftCompare` via `useDocumentDrift`/`useConfirmDrift`, mirroring the agent
    Context tab's `DriftTarget` pattern exactly (repo-scoped `repoId` comes from
    the page's own route param instead of a selector, since this page — unlike
    the agent tab — is already pinned to one repo).

- 2026-08-20 — Every onboarding tour section carries `links:
  OnboardingLink[] | null` (`{label, path}`, ungrounded links stripped
  server-side — `server/insights/INSIGHTS.md` 2026-08-20) but **no card in
  `SectionCards/**` renders it** — confirmed with
  `grep -rn "\.links" app/repos/[repoId]/onboarding` returning nothing.
  AC-45 ("every link produced by a tour" renders only as an http(s) target
  from a grounded path, any other scheme is never activatable) is therefore
  satisfied today only because there is no rendering surface for `links` to
  violate it on — the sole href-producing control in the whole feature is
  `CriticalPathsCard`'s `Open`, which is safe by construction (`githubBlobUrl`
  hardcodes the `https://github.com/...` host; `item.path` is only ever
  inserted as a per-segment `encodeURIComponent`-ed path component, so it can
  never become a URL scheme regardless of its content). If a future task adds
  a "related links" affordance per section, `groundLinks()`'s existence check
  is not itself a scheme guard — that new render site will need its own
  http(s)-only check before treating `link.path` as an `href`.

- 2026-08-20 — `AttachmentList`'s "Attached documents" list (agent Context
  tab) is NOT scoped to the active repo — `attachedItems` is built from
  `effective.documents.filter(d => d.source === "agent")`, i.e. every
  attachment the agent has ever made across every repo, per
  `ContextTab.tsx`'s own comment ("Attachments already made against another
  repo stay saved and still appear in 'Attached documents'"). That's why
  keying `AttachmentList`'s rows on `path` alone (fixed to
  `${repo_id}:${path}`, `AttachmentList.tsx:236-252`) was a real, reachable
  bug, not a theoretical one. That fix covers the React `key` only —
  `SortableRow`'s `useSortable({ id: item.path })` (`AttachmentList.tsx:167`)
  still uses `path` alone as the dnd-kit item id, so two attached docs from
  different repos sharing a path would still collide as duplicate ids inside
  `SortableContext` during a drag. Not fixed in this pass (out of scope for
  the two findings this session covered); worth flagging if a future task
  touches reordering in this list.
