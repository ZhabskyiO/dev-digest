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

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

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
