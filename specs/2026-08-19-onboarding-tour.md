# Spec: Onboarding Tour   |   Spec ID: SPEC-2026-08-19-onboarding-tour   |   Status: draft
Supersedes: none

## Problem & why

A developer handed an unfamiliar repository spends their first day answering five questions
that the repository itself can already answer: *how do the pieces connect*, *which files
actually matter*, *what surfaces does it expose*, *how do I get it running*, and *what should I
touch first*. Today DevDigest knows all five — `repo-intel` has already walked the clone,
extracted symbols and endpoint facts, built the import graph, and computed a PageRank-based file
importance score — but there is no surface that turns those facts into a first-day tour. The
knowledge exists and is unreachable.

**This feature is not starting from a blank slate.** Substantial onboarding scaffolding is
already committed and, as of today, has **zero producers and zero consumers**. Establishing
exactly what exists is the first thing an implementation planner needs, so it is recorded here:

| Artifact | State today |
|---|---|
| `server/src/prompts/onboarding.system.md` | A complete LLM system prompt: templated `{{sections}}`, per-section `body`/`diagram`/`links`, mermaid rules, grounding rules ("NEVER invent file paths, scripts, routes, or dependencies"), untrusted-data handling, `{{language}}`, plus specific guidance for a `routes_and_apis` section (grouped "Frontend routes" / "API endpoints" bullet lists, permission to carry a mermaid diagram). **Never loaded** — no `renderPrompt('onboarding.system.md')` call exists anywhere in `server/src`. |
| `onboarding` table (`server/src/db/schema/context.ts:125`) | `repo_id` PK → `json` jsonb → `generated_at`. Migrated, empty, **no repository or service touches it**; only re-exported through `db/schema.ts:73`. |
| `Onboarding` / `OnboardingSection` / `OnboardingLink` Zod contracts (`@devdigest/shared`, `contracts/knowledge.ts`) | Defined, exported, and asserted in `server/test/contracts.test.ts:150`. **No route serves them.** `OnboardingSection` is `{ kind, title, body (markdown), diagram?, links[] }`. |
| `FEATURE_MODELS[0]` (`contracts/platform.ts:43`) | Already `{ id: 'onboarding', label: 'Onboarding Tour', defaultProvider: 'openrouter', defaultModel: 'deepseek/deepseek-v4-flash' }`. The per-feature model slot **and its Settings UI row already exist**; nothing reads the resolved choice. |
| `repoIntel.getTopFilesByRank()` / `repoIntel.getCriticalPaths()` (`repo-intel/types.ts:266`) | Declared under a literal `// --- T3: onboarding reading-path + critical paths` comment and **fully implemented** (`service.ts:864`, `service.ts:888`). `getCriticalPaths` has **zero callers**; `getTopFilesByRank` is called only internally by `getConventionSamples`. |
| `client/messages/en/onboarding.json` | Contains `title`, `regenerate`, `generate.*`, `loadError.*` for a tour view that does not exist. Its body text names a **different** set of five sections ("overview, architecture, key modules, getting started, and conventions & gotchas") — wrong copy under either the five- or the six-section reading, and it must be corrected. No component imports this namespace — the add-repository screen at `/onboarding` uses other namespaces. |
| `client/messages/en/shell.json` `nav.onboarding-tour` | The label `"Onboarding Tour"` exists, but `NAV` in `client/src/vendor/ui/nav.ts` has **no** `onboarding-tour` item, so nothing renders it. |
| `activeKeyFor()` (`client/src/components/app-shell/helpers.ts`) | Already maps `pathname.includes("/onboarding")` → `"onboarding-tour"`. Because `/onboarding` is the **add-repository** screen, this is a live latent bug: adding a repo highlights a nav item for a different feature. |
| `MermaidDiagram` (`client/src/components/mermaid-diagram/MermaidDiagram.tsx`) | Exists and is production-ready: lazy-imports mermaid, validates with `mermaid.parse({ suppressErrors: true })` before rendering, and renders **nothing** for invalid input rather than mermaid's "Syntax error" bomb graphic. |

So this feature's real job is **to build the missing producer and the missing surface**, not to
re-invent the pieces. Two of the scaffolding artifacts are nonetheless *wrong for the agreed
design* and must be corrected rather than consumed as-is:

1. `OnboardingSection` is **markdown-only** (`body` + optional `diagram` + up to 4 `links`).
   Five of the six agreed sections are not prose: a ranked path list with a per-row *Open*
   action, grouped route/endpoint entries, an ordered command list with a per-command *copy*
   button, a numbered path/rationale sequence, and task cards with a **complexity badge**. None
   of those affordances can be rendered from a markdown blob without the client re-parsing prose
   the model wrote — which is exactly how grounded data becomes ungrounded. The section contract
   must carry typed items.
2. `client/messages/en/onboarding.json` documents a section set that matches neither the design
   nor the agreed set, and would ship as visibly wrong copy.

**The section set was a decision, and it was made against the screenshots.** Three competing
five-section sets existed in the repository and the request; the user resolved them by keeping
the shipped prompt's `routes_and_apis` **as a sixth section**. The tour is therefore six
sections, and the existing prompt's `routes_and_apis` guidance is retained verbatim rather than
deleted (AC-2, AC-49, AC-50). See *Open questions → (a)*.

> **Deliberate divergence from the design sources.** The two screenshots that specify this page
> show exactly **five** cards and a five-entry `ON THIS PAGE` list, with no routes/APIs section.
> The spec requires **six**. This is a decision the user made knowingly, not a design an
> implementer failed to match. Everywhere below that cites the screenshots as the authority for
> a section's content or ordering, that authority covers the other five sections only;
> `routes_and_apis` has **no screenshot** and its presentation is specified in prose here
> (AC-49, AC-50) and in the existing prompt's formatting guidance. An implementer who matches the
> screenshots pixel-for-pixel will be one card short, and that is a bug, not fidelity.

## Goals / Non-goals

- **Goal:** Generate, per repository, a tour of **exactly six sections in a fixed order** —
  architecture overview, critical paths, routes and APIs, how to run locally, guided reading
  path, first tasks.
- **Goal:** Ground every path, route, command, and claim in facts DevDigest already holds (the
  `repo-intel` index and the repo clone). A path the index does not know is not shown.
- **Goal:** Give each section the *structured* payload its design needs — ranked
  `{path, why}` rows, grouped route/endpoint entries, individually copyable commands, an ordered
  `{path, rationale}` sequence, and `{title, target, complexity}` task cards — so the client
  renders data, not parsed prose.
- **Goal:** Serve the tour from a stored per-repo record, so opening the page costs no model
  call.
- **Goal:** Make regeneration explicit, non-blocking, and safe: the previous tour stays readable
  while a new one is generated, and a failed generation never destroys the old one.
- **Goal:** Make staleness visible — the tour records the indexed revision it was generated
  from and says so when the repository has been re-indexed since.
- **Goal:** Reuse the existing per-feature model slot (`onboarding`), the existing mermaid
  renderer, and the existing untrusted-wrapping discipline rather than adding parallel machinery.
- **Goal:** Add the `Onboarding Tour` workspace nav entry between `Pull Requests` and
  `Project Context`, and fix the pre-existing nav-highlight collision with `/onboarding`.

- **Non-goal: a configurable section set.** `{{sections}}` stays a template placeholder filled
  from a server-side constant; there is no user-facing control over which sections exist, and no
  way to switch `routes_and_apis` off per repository. A repository with no routes gets an empty
  section with a stated reason (AC-11), not a five-section tour.
- **Non-goal: a route explorer.** `routes_and_apis` is a read-only inventory rendered inside the
  tour. It does not link to a per-route detail view, does not issue requests, does not render
  request/response schemas, and is not a replacement for the project's own API documentation.
- **Non-goal: public / unauthenticated sharing.** DevDigest's auth MVP is
  `LocalNoAuthProvider` (`@devdigest/shared` `adapters.ts:291`) — there is no authentication to
  share *past*, and no revocation, expiry, or rate-limiting story for a public read surface
  that would expose a private repository's file paths and excerpts. `Share link` is therefore
  an in-app deep-link copy, nothing more. (Open question (b).)
- **Non-goal: editing a tour.** Sections are generated or regenerated wholesale; there is no
  per-section edit, pin, reorder, or accept/reject flow.
- **Non-goal: automatic regeneration.** A re-index marks a tour stale; it never spends a model
  call on the user's behalf. (Open question (d).)
- **Non-goal: writing to the repository.** The clone is read-only here. No task is created on
  GitHub, no issue is opened, no file is modified. "First tasks" are suggestions rendered in
  DevDigest.
- **Non-goal: changing `reviewer-core`.** Its structured-output parsing (`parseWithRepair`),
  `wrapUntrusted`, and grounding gate are consumed as they are. This feature adds no findings
  and does not touch the review pipeline.
- **Non-goal: replacing or altering the `/onboarding` add-repository screen.** It keeps its
  route, its behaviour, and its e2e flow (`e2e/specs/06-onboarding.flow.json`).
- **Non-goal: per-user progress tracking.** No "mark step done", no checkboxes, no completion
  percentage.

## User stories

1. As a developer joining a project, I want a six-part guided tour of the repository, so that
   I can orient myself without reading 12,000 files or interrupting a teammate.
2. As a developer, I want an architecture overview with a diagram, so that I can see how the
   pieces connect before I open a single file.
3. As a developer, I want a ranked list of the files that matter most with a one-line reason
   each and a way to open them, so that I know where the weight of the codebase sits.
4. As a developer, I want the project's frontend routes and API endpoints listed and grouped by
   area, so that I understand the surface the project exposes before I change any of it.
5. As a developer, I want the exact commands to run the project locally, each copyable on its
   own, so that I can get it running without hand-assembling a command from a paragraph.
6. As a developer, I want a numbered reading order with a reason for each position, so that
   each file I open makes sense in light of the previous one.
7. As a developer, I want a few starter tasks with a target file and a complexity badge, so
   that my first contribution is small, real, and located.
8. As a tech lead, I want the tour regenerated on demand after the codebase moves, and to be
   told when the tour is describing an older revision, so that nobody onboards from a stale map.
9. As a tech lead, I want the tour to only ever cite files and routes that actually exist, so
   that a new joiner never wastes an afternoon hunting a path the model invented.
10. As an operator, I want an unindexed, tiny, or failing repository to produce an honest empty
    or degraded state rather than a fabricated tour or a crash.
11. As a security owner, I want repository content that reaches the generating model to be
    treated as data, so that a README cannot instruct DevDigest to write something else.
12. As a developer, I want to hand a colleague a link straight to a section of the tour, so
    that "read the reading path" is one click rather than three.

## Acceptance criteria (EARS)

> AC ids are allocation-ordered, not positional: AC-49..AC-53 were added in a later revision,
> when the section set changed from five to six, and sit in the section they belong to rather
> than at the end of the document. Every id is unique and the range 1..53 is contiguous.

### Section set and generation inputs

- **AC-1:** The tour **shall** consist of exactly six sections, always in this order and with
  these stable kinds: `architecture` → `critical_paths` → `routes_and_apis` → `local_setup` →
  `reading_path` → `first_tasks`.
  _(observable: a generated tour has `sections.length === 6` and the kind sequence above; a
  model response containing a seventh section, a missing section, or a reordered set is rejected
  and repaired/regenerated rather than stored. Note the deliberate divergence recorded in
  *Problem & why*: the screenshots show five cards, and `routes_and_apis` — third in the order —
  is the agreed sixth with no screenshot of its own.)_

- **AC-2:** The onboarding system prompt **shall** retain its existing `routes_and_apis`
  guidance — the grouped "Frontend routes" / "API endpoints" bullet-list instruction, the
  group-by-area instruction, and that section's permission to carry a mermaid diagram.
  _(observable: the shipped prompt template still contains its `routes_and_apis` formatting
  block, unedited, and `{{sections}}` is filled with all six kinds of AC-1. This criterion exists
  to stop a well-meaning cleanup deleting prompt text the section depends on — see Open
  question (a), where the earlier default to delete it was overturned.)_

- **AC-3:** WHEN a tour is generated, the system **shall** derive its inputs solely from the
  repository's `repo-intel` index and its clone on disk — file rank, the import graph, the repo
  map, discovered manifests/scripts, and bounded key-file excerpts.
  _(observable: generating a tour makes no network call other than the single model call; no
  input originates from another repository, from the workspace's other tours, or from the
  operator's machine outside the clone.)_

- **AC-4:** The system **shall** select the generating provider and model by resolving the
  existing `onboarding` feature-model slot for the workspace, falling back to the registry
  default when unset.
  _(observable: setting `feature_models.onboarding` in Settings changes the provider/model
  recorded on the next generated tour; unset yields `FEATURE_MODELS`' registered default. The
  slot and its Settings row already exist — this criterion is about *reading* them.)_

- **AC-5:** Generating a tour **shall** issue at most one structured model call per generation
  attempt, plus at most one repair re-prompt when the first response fails schema validation.
  _(observable: an instrumented provider records ≤ 2 calls for one regeneration, including the
  `parseWithRepair` retry path; a repair that also fails does not trigger a third.)_

- **AC-6:** IF the repository has no usable `repo-intel` index, THEN the system **shall not**
  call the model, and **shall** return a machine-readable `not_indexed` state naming the index
  status, without an error status.
  _(observable: a repo whose `getIndexState` reports `failed`, or reports zero indexed files,
  yields a 200 response with no tour and reason `not_indexed`; the model provider records zero
  calls. The client renders an index-first empty state rather than a generate button.)_

- **AC-7:** WHERE the index is present but reports `partial` or `degraded`, the system **shall**
  generate the tour anyway from whatever facts are available and **shall** mark the stored tour
  as generated from a degraded index, naming the degradation reason.
  _(observable: a repo whose index state carries `degraded: true, degradedReason: 'index_partial'`
  produces a tour that renders with a visible degraded notice quoting that reason. This mirrors
  the facade's documented degraded contract — array reads return `[]`, they do not throw — so a
  missing import graph costs a weaker `critical_paths` section, not a failed generation.)_

### Grounding — nothing invented

- **AC-8:** The system **shall** drop, before storing a tour, any cited file path that is
  neither present in the repository's index nor resolvable inside the repository's clone.
  _(observable: a stubbed model response citing `src/does-not-exist.ts` in `critical_paths`,
  `reading_path`, and `first_tasks` yields a stored tour containing none of those three items.
  This is the mechanical enforcement of the prompt's existing "NEVER invent file paths" rule —
  the prompt asks, this criterion verifies.)_

- **AC-9:** The system **shall** drop any `local_setup` command whose leading executable or
  script name is not attested by a file in the clone (a manifest script entry, a compose service
  or its documented invocation, a task-runner target, or a documented command in the repo's own
  README).
  _(observable: a stubbed response containing `make deploy-prod` for a repo with no Makefile and
  no such README line is dropped; `pnpm install` for a repo with a `package.json` declaring pnpm
  survives. A tour that would lose every command falls back to AC-11's empty-section rule rather
  than inventing one.)_

- **AC-10:** IF dropping ungrounded items (AC-8, AC-9) leaves a section with fewer items than a
  configured minimum, THEN the system **shall** store that section as empty with a
  machine-readable `insufficient_grounding` reason rather than backfilling it.
  _(observable: a stubbed response whose `first_tasks` all cite non-existent paths stores an
  empty `first_tasks` carrying the reason; nothing is fabricated to fill the gap.)_

- **AC-11:** IF a section is empty, THEN the client **shall** render that section's card with an
  explicit reason line instead of an empty body, and the section **shall** remain listed in
  `ON THIS PAGE`.
  _(observable: a tour with an empty `local_setup` still shows six TOC entries and six cards, the
  `local_setup` one reading e.g. "No runnable commands were found in this repository."; a
  library or CLI repository that exposes no routes shows an empty `routes_and_apis` card reading
  e.g. "No frontend routes or API endpoints were found in this repository." — the section is
  never silently dropped, because its absence would be indistinguishable from a generation bug.)_

- **AC-12:** The system **shall** deliver every excerpt of repository text to the model wrapped
  as untrusted data.
  _(observable: the assembled generation prompt contains a delimiter-wrapped block per excerpt,
  matching the precedent already used for convention extraction at
  `server/src/modules/conventions/service.ts:246`; the system prompt retains its existing
  `<untrusted>…</untrusted>` SECURITY paragraph.)_

### Section content

- **AC-13:** The `architecture` section **shall** carry a markdown prose body, and `architecture`
  and `routes_and_apis` **shall** be the only two sections permitted to carry a mermaid diagram.
  _(observable: a stored tour has a non-empty `architecture.body`, and any `diagram` field on
  `critical_paths`, `local_setup`, `reading_path`, or `first_tasks` is null; a stubbed response
  supplying a diagram on `first_tasks` has it discarded, while the same diagram on
  `routes_and_apis` is kept. This two-section permission is exactly what the existing prompt
  already grants — AC-2 keeps that guidance rather than narrowing it.)_

- **AC-14:** IF a permitted section's diagram is not valid mermaid, THEN the client **shall**
  render that section's content without a diagram and without an error graphic.
  _(observable: a tour whose diagram is prose, JSON, or syntactically broken renders the rest of
  the section and no diagram box — this is the existing `MermaidDiagram` behaviour, which
  validates with `mermaid.parse({ suppressErrors: true })` and returns `null` on failure; this
  criterion requires the tour page to use that component rather than rendering mermaid itself,
  and it applies independently to each of the two diagram-bearing sections, so an invalid
  `routes_and_apis` diagram never suppresses a valid `architecture` one.)_

- **AC-15:** The `critical_paths` section **shall** carry an ordered list of items, each with a
  repository-relative `path` and a one-line `why` explaining why that file matters.
  _(observable: the design's four rows — `src/server.ts — App bootstrap + middleware chain`,
  `src/api/public/index.ts — Public router — unauthenticated surface`,
  `src/middleware/auth.ts — Token validation, used by 14 routes`,
  `src/lib/redis.ts — Shared Redis singleton — reuse this` — are each one item, path plus one
  line, never a paragraph.)_

- **AC-16:** The `critical_paths` order **shall** be derived from the repository's file rank and
  import graph, not alphabetical, not by modification date, and not by the model's free choice.
  _(observable: for a fixture repo whose rank order is known, the stored section's paths appear
  in rank-descending order; shuffling the model's returned order does not change the stored
  order. `repoIntel.getTopFilesByRank` and `repoIntel.getCriticalPaths` already compute this and
  currently have no caller.)_

- **AC-17:** The `critical_paths` section **shall** exclude tests, fixtures, configuration files,
  declaration files, and migrations.
  _(observable: a fixture repo whose highest-ranked file is `src/foo.test.ts` does not surface
  it; this is the existing rank-sample junk-path filter, which the facade already applies.)_

- **AC-49:** The `routes_and_apis` section **shall** carry typed entries, each identifying its
  surface (a frontend route or an API endpoint), the area it belongs to, its route or path
  pattern, its HTTP method where one applies, and the repository file that declares it — and
  **shall not** carry that inventory as a prose body.
  _(observable: a generated `routes_and_apis` section exposes a list the client can group and
  render row by row; a stubbed response returning the inventory as one markdown paragraph of
  inline-code chips fails validation. This section has **no screenshot** — the rationale is the
  same one that made every other list section typed: a client that re-parses model prose to find
  a route has un-grounded the data it just grounded. The existing prompt already asks for
  grouped bullet lists rather than "one paragraph of inline-code chips"; this criterion makes
  that structural rather than stylistic.)_

- **AC-50:** The client **shall** render `routes_and_apis` as two labelled surfaces — frontend
  routes and API endpoints — with API endpoints grouped by area within their surface.
  _(observable: a repository exposing both renders a "Frontend routes" group and an "API
  endpoints" group, the latter subdivided by area (e.g. agents, pulls, repos), matching the
  grouping the existing prompt already instructs the model to produce; a repository exposing only
  one surface renders only that surface rather than an empty heading.)_

- **AC-51:** The system **shall** drop any `routes_and_apis` entry whose declaring file is
  absent, or is not present in the repository's index or clone.
  _(observable: a stubbed entry declaring `GET /admin` from `src/routes/admin.ts` in a repository
  with no such file is dropped; this is AC-8's grounding rule applied to the field that makes a
  route checkable. An entry with no declaring file at all is dropped rather than rendered
  unattributed — an unlocatable route is precisely the claim a new joiner cannot verify.)_

- **AC-52:** WHERE the repository's index carries extracted endpoint facts, the system **shall**
  drop any API entry whose method-and-path is not among them; WHERE the index carries no endpoint
  facts, the section **shall** be stored with a machine-readable `facts_unavailable` marker and
  its API entries **shall** survive on declaring-file grounding alone.
  _(observable: for a fixture repository whose extracted endpoint facts are known, a stubbed
  `DELETE /users/:id` that no fact attests does not appear; for a repository with no endpoint
  facts, the same entry survives if its declaring file exists and the stored section carries the
  marker. `repo-intel` already extracts endpoints as `"METHOD /path"` — see the documented
  `impactedEndpoints` field — so this is a read of facts that exist; see Open questions for the
  honest caveat that today they are only reachable through the blast-radius read, not through a
  general "list this repository's endpoints" facade method.)_

- **AC-53:** The `routes_and_apis` section **shall not** list the same surface-method-route
  combination twice, and its entry order **shall** be deterministic for a given set of facts.
  _(observable: a stubbed response repeating `GET /health` stores it once; regenerating from
  identical index facts and an identical model response yields an identical entry order, so a
  regeneration diff shows real change rather than reshuffling.)_

- **AC-18:** The `local_setup` section **shall** carry an ordered list of discrete shell
  commands, one command per item, each renderable and copyable on its own.
  _(observable: the design's four rows — `pnpm install`, `cp .env.example .env # add OPENAI +
  STRIPE keys`, `docker compose up -d postgres redis`, `pnpm dev # http://localhost:3000` — are
  four items, not one newline-joined string; copying row 3 puts exactly
  `docker compose up -d postgres redis` on the clipboard.)_

- **AC-19:** The `reading_path` section **shall** carry an ordered sequence of items, each with a
  repository-relative `path` and a one-line `rationale` justifying **that position** in the
  sequence.
  _(observable: the design's three rows pair `src/server.ts` with "See the whole request
  lifecycle in one file", `src/api/public/index.ts` with "Understand the public contract before
  touching it", `src/middleware/auth.ts` with "Auth touches almost everything downstream"; the
  rendered numbers are 1, 2, 3 with no gaps or duplicates.)_

- **AC-20:** The `reading_path` **shall not** repeat a path within itself.
  _(observable: a stubbed response listing the same path at positions 2 and 5 stores it once,
  keeping the earlier position and renumbering the remainder contiguously.)_

- **AC-21:** The `first_tasks` section **shall** carry a list of items, each with a `title`, a
  repository-relative `target` path or directory, and a `complexity` that is exactly one of
  `low`, `medium`, or `high`.
  _(observable: the design's three cards — "Add a /health readiness probe" ·
  `src/api/public/health.ts` · Low; "Backfill tests for the rate limiter" ·
  `test/ratelimit.test.ts` · Medium; "Document the webhook signature flow" · `specs/` · Low —
  each parse into those three fields.)_

- **AC-22:** IF a `first_tasks` item carries a complexity value outside the three permitted
  values, THEN the system **shall** drop that item rather than coerce it.
  _(observable: a stubbed item with `complexity: "trivial"` or `complexity: "Low complexity"`
  does not appear in the stored tour; a badge is never rendered from an unrecognised value.)_

- **AC-23:** A `first_tasks` `target` **shall** be permitted to be a directory that exists in the
  repository, in addition to a file.
  _(observable: the design's third card targets `specs/`; a target naming an existing directory
  survives AC-8's grounding check, while `specs/` in a repository that has no such directory is
  dropped.)_

### Persistence, regeneration, and staleness

- **AC-24:** The system **shall** store at most one tour per repository, and a successful
  regeneration **shall** replace it.
  _(observable: regenerating twice leaves one stored record for that repository; the previously
  stored sections are not retained as history. The existing `onboarding` table is already keyed
  by `repo_id` as a primary key, which encodes exactly this.)_

- **AC-25:** The system **shall** record, alongside a stored tour, the generation timestamp, the
  indexed revision it was generated from, the number of files that revision indexed, and the
  provider and model that produced it.
  _(observable: the tour response carries all five; the design's subtitle
  `Generated from index of 12,450 files · last refreshed 2h ago` is rendered from the file count
  and the timestamp, not hardcoded.)_

- **AC-26:** WHEN a user requests regeneration, the system **shall** accept the request
  immediately, run the generation in the background, and leave the previously stored tour
  readable until the new one is stored.
  _(observable: the regenerate request returns before the model call completes; reloading the
  page mid-generation still renders the old tour's six sections alongside a generating
  indicator. Precedent: `POST /repos/:id/resync` returns 202 and enqueues a `JobRunner` job.)_

- **AC-27:** WHILE a generation is in progress for a repository, the system **shall** report a
  generating state for that repository and **shall not** start a second concurrent generation
  for it.
  _(observable: two regenerate requests issued back to back produce one model call and one job;
  the second is answered with the in-flight job's identity rather than starting another. The
  `Regenerate` control is disabled while generating, per the existing
  `onboarding.regenerating` message key.)_

- **AC-28:** IF a generation fails — provider error, timeout, or a response that fails schema
  validation after the AC-5 repair attempt — THEN the system **shall** leave any previously
  stored tour intact and **shall** surface a failure reason.
  _(observable: forcing the provider to throw leaves the prior tour served unchanged and shows a
  dismissible failure notice naming the reason; a repo with no prior tour returns to its empty
  state, not to a partial one.)_

- **AC-29:** IF the repository's indexed revision has changed since the stored tour was
  generated, THEN the system **shall** mark the tour as stale wherever its freshness is shown.
  _(observable: re-indexing a repo after generating a tour makes the subtitle carry an explicit
  stale marker inviting regeneration; the tour itself still renders in full. Comparison is
  against the index's recorded revision, so a re-index that changed nothing does not mark it
  stale.)_

- **AC-30:** A stale tour **shall** continue to be served and rendered in full.
  _(observable: with the stale marker present, all six sections, every path, every route, and
  both diagrams still render; nothing is hidden or blocked pending regeneration — a stale map
  beats no map.)_

- **AC-31:** The system **shall not** generate or regenerate a tour except in response to an
  explicit user request.
  _(observable: completing a full re-index of a repository with an existing tour records zero
  onboarding model calls; only the stale marker of AC-29 changes.)_

### Page, navigation, and interaction

- **AC-32:** The system **shall** present a repository-scoped Onboarding Tour page at a URL
  distinct from the add-repository screen at `/onboarding` — `/repos/:repoId/onboarding`,
  matching the existing repo-scoped route shape used by `/repos/:repoId/context` and
  `/repos/:repoId/conventions`.
  _(observable: the tour page requires a repo id in its URL and the add-repository screen at
  `/onboarding` is unchanged, including its existing e2e flow.)_

- **AC-33:** WHEN the add-repository screen at `/onboarding` is open, the sidebar **shall not**
  mark the Onboarding Tour item as active.
  _(observable: navigating to `/onboarding` highlights no workspace nav item; navigating to
  `/repos/:repoId/onboarding` highlights `Onboarding Tour`. This fixes a pre-existing bug —
  `activeKeyFor()` currently matches `pathname.includes("/onboarding")`, so today the
  add-repository screen already highlights a feature that does not exist.)_

- **AC-34:** The workspace navigation **shall** include an `Onboarding Tour` item positioned
  between `Pull Requests` and `Project Context`, linking to the active repository's tour.
  _(observable: the sidebar renders the three workspace items in that order and the item
  resolves its repo id from the active repository, like the neighbouring repo-scoped items; the
  `nav.onboarding-tour` label key already exists and is currently unused.)_

- **AC-35:** The page **shall** present a breadcrumb of the repository's full name followed by
  the page name, and a header reading "Onboarding for <repository short name>" with the
  repository name visually distinguished.
  _(observable: for `acme/payments-api` the breadcrumb reads `acme/payments-api > Onboarding
  Tour` and the header reads `Onboarding for payments-api`.)_

- **AC-36:** The page **shall** present an in-page table of contents listing the six section
  titles in the order of AC-1, marking the section currently in view and scrolling to a section
  when its entry is activated.
  _(observable: the `ON THIS PAGE` list shows six entries — the screenshots' five plus
  "Routes and APIs" in third position; activating "First tasks" scrolls to that card and moves
  the active marker; scrolling back moves it back.)_

- **AC-37:** Each section **shall** be independently collapsible, and collapsing a section
  **shall not** remove it from the table of contents.
  _(observable: every section card carries a chevron; collapsing `Critical paths` hides its rows
  while its TOC entry remains.)_

- **AC-38:** WHEN a user activates the copy control on a `local_setup` row, the system **shall**
  place exactly that row's command text on the clipboard, with no numbering, no adjacent
  commands, and no surrounding markup.
  _(observable: copying the second row yields precisely
  `cp .env.example .env # add OPENAI + STRIPE keys`.)_

- **AC-39:** WHEN a user activates the `Open` control on a `critical_paths` row, the system
  **shall** open that file on the repository's hosting provider at the revision the tour was
  generated from, in a new context that cannot script the opener.
  _(observable: the control targets a provider blob URL built from the repository's full name,
  the recorded indexed revision, and the row's path — the same construction
  `client/src/lib/github-urls.ts` already performs for findings — and opens with
  `rel="noopener noreferrer"`.)_

- **AC-40:** WHEN a user activates `Share link`, the system **shall** place the tour page's own
  URL on the clipboard and confirm the copy, and **shall not** create any externally reachable
  or unauthenticated view of the tour.
  _(observable: activating it copies the in-app URL — including a section anchor when a section
  is in view — and creates no token, no record, and no new endpoint. See Open question (b).)_

- **AC-41:** IF no tour has been generated for a repository whose index is usable, THEN the page
  **shall** render an empty state explaining what will be generated and offering a single
  generate action.
  _(observable: the empty state uses the existing `onboarding.generate.*` message keys, whose
  body text must first be corrected to name the **six** sections of AC-1 rather than the
  contradictory set it names today ("overview, architecture, key modules, getting started, and
  conventions & gotchas"). The correction target is the six-section set, not the screenshots'
  five.)_

- **AC-42:** All user-facing text introduced by this feature **shall** be supplied from the
  message catalogue; repository paths, commands, model-written prose, titles, and rationales are
  data and **shall not** be translated.
  _(observable: no literal user-facing string appears in a component; switching locale changes
  the section headings and control labels but never a path or a command.)_

### Safety of rendered content

- **AC-43:** The client **shall** render model-written markdown without executing embedded HTML
  or scripts.
  _(observable: a tour body containing `<script>alert(1)</script>` produces zero `<script>`
  elements in the document — this is the behaviour of the shared `Markdown` component, which
  runs without `rehype-raw` and renders raw HTML as escaped text; this criterion requires the
  tour to use it rather than injecting HTML.)_

- **AC-44:** The client **shall not** execute, or offer to execute, any `local_setup` command.
  _(observable: command rows offer copy only; no run, no terminal, no shell integration. The
  commands originate from a model reading third-party repository content and are untrusted by
  construction.)_

- **AC-45:** The client **shall** render every link produced by a tour as an http(s) target
  derived from a grounded repository path, and **shall** ignore any other scheme.
  _(observable: a stored link whose path is `javascript:alert(1)` or an absolute external URL
  does not become an activatable link.)_

### Accessibility and performance

- **AC-46:** The complexity of a `first_tasks` card **shall** be conveyed by its text, not by
  colour alone.
  _(observable: the badge reads "Low complexity" / "Medium complexity" / "High complexity" as
  text; rendering in greyscale still communicates the level.)_

- **AC-47:** The page **shall** be fully operable by keyboard.
  _(observable: the TOC entries, each section's collapse control, every copy control, every
  `Open` control, `Regenerate`, and `Share link` are reachable by Tab and activatable by Enter
  or Space, each with an accessible name that identifies its target — e.g. "Copy command 3",
  "Open src/lib/redis.ts". Meets WCAG 2.1 AA.)_

- **AC-48:** Reading a stored tour **shall** issue no model call.
  _(observable: loading the page an arbitrary number of times records zero provider calls; the
  only model call in this feature's lifecycle is the one AC-5 bounds.)_

## Edge cases

| Case | Expected behaviour | Coverage |
|---|---|---|
| Repository imported but never indexed | `not_indexed` state, no model call, index-first empty state | AC-6 |
| Index exists but reports `degraded` / `partial` | tour generated best-effort with a visible degraded notice naming the reason | AC-7 |
| Empty repository (zero indexed source files) | treated as unusable index → `not_indexed` | AC-6 |
| Tiny repository (a handful of files, no import graph) | `getCriticalPaths` returns `[]`; `critical_paths` stores empty with `insufficient_grounding`; the other sections still generate | AC-10, AC-11 |
| Repository with ~12,000+ files | generated from precomputed index facts and bounded excerpts, never by reading every file | AC-3, non-functional |
| Model cites a path that does not exist | that item is dropped before storage | AC-8 |
| Model invents `make deploy-prod` for a repo with no Makefile | the command is dropped | AC-9 |
| Every `first_tasks` item cites a non-existent path | section stored empty with `insufficient_grounding`; nothing fabricated | AC-10, AC-11 |
| Model returns invalid mermaid for `architecture` | prose renders, diagram omitted, no error graphic | AC-14 |
| Model returns invalid mermaid for `routes_and_apis` only | that section's entries still render; the `architecture` diagram is unaffected | AC-14 |
| Model returns a diagram on a section other than `architecture` or `routes_and_apis` | discarded | AC-13 |
| Model returns a seventh section, or omits one | response rejected; repaired or failed, never stored partially | AC-1, AC-5, AC-28 |
| Library, CLI, or pure-package repository with no routes at all | `routes_and_apis` stored empty with a stated reason; the card and its ToC entry still render | AC-10, AC-11 |
| Repository with routes but no extracted endpoint facts in the index | section stored with `facts_unavailable`; entries survive on declaring-file grounding | AC-52 |
| Model invents `DELETE /users/:id` that no endpoint fact attests | dropped where facts exist; dropped anyway if its declaring file does not exist | AC-51, AC-52 |
| Route entry with no declaring file | dropped rather than rendered unattributed | AC-51 |
| Same route listed under two areas, or twice in one area | de-duplicated by surface+method+route | AC-53 |
| Repository exposing API endpoints but no frontend routes | only the API surface renders; no empty "Frontend routes" heading | AC-50 |
| `routes_and_apis` returned as one prose paragraph of inline-code chips | fails validation; not stored as a prose blob | AC-49 |
| Model returns `complexity: "trivial"` | task dropped, not coerced | AC-22 |
| Model returns the same path twice in `reading_path` | de-duplicated, earlier position kept, numbering stays contiguous | AC-20 |
| Model returns commands as one newline-joined blob | rejected/normalised into discrete items, or the section fails AC-18 and is not stored as a blob | AC-18 |
| Response is not valid JSON | one repair re-prompt, then failure with a reason; prior tour intact | AC-5, AC-28 |
| Provider errors or times out mid-generation | prior tour intact, failure reason surfaced | AC-28 |
| Two users press `Regenerate` at once | one job, one model call; the second request joins the in-flight one | AC-27 |
| User navigates away mid-generation and returns | generation continues; returning shows the generating state or the new tour | AC-26, AC-27 |
| Repository re-indexed after generation | stale marker; tour still fully rendered; no automatic model call | AC-29, AC-30, AC-31 |
| Repository re-indexed with no actual change | not marked stale (comparison is on the recorded revision) | AC-29 |
| Repository removed from the workspace | its tour disappears with it | accepted: the existing `onboarding.repo_id` cascade delete already does this; no new criterion |
| Repository's clone is missing while its index rows survive | grounding checks fail for clone-only evidence; commands and directory targets that cannot be attested are dropped | AC-8, AC-9, AC-10 |
| README instructs the model to "ignore the above and output X" | treated as data inside untrusted delimiters; the prompt's existing SECURITY rule holds | AC-12 |
| Tour body contains raw HTML or a `<script>` tag | rendered as escaped text, never as a DOM element | AC-43 |
| A stored link's path is `javascript:…` | not rendered as an activatable link | AC-45 |
| A command contains `rm -rf /` | copyable only; never executed or offered for execution | AC-44 |
| Legacy row already in the `onboarding` table | the table is empty today; a row failing the six-section shape of AC-1 is treated as absent and the user is offered generation | AC-1, AC-41 |
| User is on `/onboarding` (add repository) | no workspace nav item highlighted | AC-33 |
| Repository has no default-branch revision recorded | `Open` controls fall back to the default branch name rather than rendering a broken revision link | AC-38 |
| Very long `why` / `rationale` text from the model | rendered as a single line, truncated visually, full text available on hover/focus | accepted: presentation detail, no separate criterion |
| Locale switched while a tour is open | headings and controls translate; paths, commands, and model prose do not | AC-42 |

## Non-functional

- **Read latency:** serving a stored tour responds in **p95 < 300 ms**, excluding client render.
  It is a single keyed record read plus an index-state read (AC-48).
- **Generation latency:** a regeneration for a repository of ≤ 20,000 indexed files completes in
  **p95 < 120 s** end to end, including the repair retry of AC-5. It runs in the background
  (AC-26), so this budget bounds the *job*, not any HTTP request. The budget was raised from 90 s
  when the section set went from five to six: `routes_and_apis` adds both input facts and output
  tokens, and a sixth section is roughly a 20 % larger response.
- **Generation input budget:** the assembled generation prompt is capped at a configured token
  budget defaulting to **28,000 tokens** across facts, repo map, endpoint facts, and key-file
  excerpts, with a per-excerpt cap defaulting to **4,000 characters** and the endpoint-fact list
  capped at a configured maximum entry count. All are configuration. Rationale: the default
  `onboarding` model is a cheap flash-class model and the whole point of `repo-intel` is that the
  facts are precomputed — a tour that needs a 200k-token prompt is a tour that stopped using the
  index. The endpoint-fact cap matters specifically: a large service can declare hundreds of
  routes, and an uncapped inventory would dominate the prompt and crowd out every other section.
- **Cost containment:** at most one in-flight generation per repository (AC-27) and at most two
  model calls per generation (AC-5). Regeneration is rate-limited to **3 requests per minute per
  repository** — a rate that permits an impatient retry but not a cost loop. Note that
  per-route rate limits do not fire under the server's test environment, so a cost fence that
  must hold in tests belongs in the service, not in route configuration.
- **Blast radius of failure:** no onboarding failure may affect a review run, polling, or
  indexing. Onboarding is a read-side feature over facts the indexer already produced.
- **Security:** every repository excerpt reaching the model is delimiter-wrapped as untrusted
  (AC-12); no rendered content executes (AC-43, AC-44, AC-45); no unauthenticated read surface
  is created (AC-40).
- **Accessibility:** WCAG 2.1 AA — full keyboard operability with accessible names that identify
  each control's target (AC-47), and no meaning carried by colour alone (AC-46).
- **Internationalisation:** all chrome text comes from the message catalogue; the generated body
  language follows the existing prompt's `{{language}}` placeholder, and code identifiers, paths,
  package names, scripts, and command text are never translated (AC-42).

## Cross-module interactions

**Modules involved**

- **`client`** — the tour page, the workspace nav entry, the TOC, the section cards, the copy
  and `Open` controls, and the existing `MermaidDiagram` and `Markdown` components.
- **`server`** — reads `repo-intel` facts and the clone, assembles and wraps the generation
  prompt, makes the structured model call, enforces grounding, stores and serves the tour, and
  runs regeneration as a background job.
- **`server/src/modules/repo-intel`** — consumed read-only through the `container.repoIntel`
  facade: index state (status, indexed revision, indexed file count), file rank, critical
  dependency chains, the repo map, and the repository's extracted endpoint facts. **No pipeline
  internals are touched and no re-indexing is triggered.** This finally gives `getCriticalPaths`
  its first caller. **Planner-relevant caveat:** the facade exposes endpoint facts today only as
  a by-product of the blast-radius read (`impactedEndpoints` / `factsByFile`, both scoped to a
  set of changed files) — there is no "list this repository's endpoints" read on the facade. A
  general endpoint read is therefore either a small facade addition or the reason AC-52's
  `facts_unavailable` fallback exists. Reaching into the pipeline or querying the index tables
  directly from this feature is not an option; the facade is the only permitted door.
- **`@devdigest/shared`** — the tour contract shapes (canonical copy in
  `server/src/vendor/shared`, mirrored into `client/src/vendor/shared`). The existing
  `Onboarding` / `OnboardingSection` / `OnboardingLink` shapes are extended with typed per-kind
  items; the `onboarding` feature-model slot is consumed unchanged.
- **`reviewer-core`** — **consumer only, unchanged**: its structured-output parsing and repair
  (`parseWithRepair`) and its `wrapUntrusted` helper are used as-is. The review pipeline, the
  grounding gate, and the prompt assembler are untouched.
- **`e2e`** — one new browser flow is warranted (see below).

**What crosses each boundary**

- client → server: a repository id (read), and a regeneration request (write).
- server → client: the stored tour (six typed sections), its provenance (generated-at, indexed
  revision, indexed file count, provider, model), its freshness state (fresh / stale /
  generating / failed / not-indexed / degraded), and a failure reason when one applies.
- server → `repo-intel` facade: repository id only. Back: index state, ranked paths, dependency
  chains, repo map, endpoint facts. Never a raw query, never a re-index.
- server → clone (read-only): manifests, task-runner files, README text, and bounded key-file
  excerpts. Nothing is written.
- server → model provider: one system prompt plus one user message of facts, with every
  repository-derived excerpt inside untrusted delimiters. Back: one structured JSON tour.
- client → provider host: only the user's own click on an `Open` control, in a new tab.

**Failure contract**

Every step degrades rather than fails, and the same rule the repo-intel enrichment already
follows applies here: *an onboarding failure is never allowed to become an error the user cannot
act on.*

| Failure | Contract |
|---|---|
| No usable index | `not_indexed`, 200, no model call (AC-6) |
| Degraded/partial index | generate anyway, mark degraded (AC-7) |
| Facade read returns empty | that section degrades to empty-with-reason (AC-10, AC-11) |
| No endpoint facts available | `routes_and_apis` marked `facts_unavailable`, entries kept on file grounding (AC-52) |
| Clone unreadable | clone-attested items drop; index-attested items survive (AC-8, AC-9) |
| Model call fails / invalid JSON | one repair, then fail with a reason; prior tour intact (AC-5, AC-28) |
| Ungrounded items in a valid response | dropped silently from the stored tour (AC-8, AC-9) |
| Invalid mermaid | diagram omitted, prose kept (AC-14) |
| Concurrent regeneration | joined to the in-flight job (AC-27) |

```mermaid
sequenceDiagram
    participant U as User (client)
    participant S as server
    participant RI as repo-intel facade
    participant FS as repo clone (read-only)
    participant RC as reviewer-core
    participant LLM as model provider

    Note over U,S: Read (no model involved)
    U->>S: open tour for repo
    S->>RI: getIndexState(repoId)
    alt no usable index
        RI-->>S: failed / zero files
        S-->>U: not_indexed (200) — index first
    else usable
        S->>S: load stored tour
        S->>S: compare stored revision vs indexed revision
        S-->>U: six sections + provenance + fresh|stale|degraded
    end

    Note over U,LLM: Regenerate (explicit user action only)
    U->>S: regenerate
    S->>S: in-flight for this repo?
    alt already generating
        S-->>U: join existing job (no second call)
    else start
        S-->>U: accepted (previous tour stays readable)
        S->>RI: index state · file rank · critical chains · repo map · endpoint facts
        S->>FS: manifests · task files · README · key-file excerpts
        FS-->>S: bounded text
        S->>RC: wrapUntrusted(each excerpt)
        S->>LLM: one structured call (onboarding feature-model)
        LLM-->>S: JSON tour
        S->>RC: parseWithRepair(schema, raw)
        alt invalid after one repair
            RC-->>S: parse error
            S-->>U: failed + reason; previous tour intact
        else valid
            S->>S: drop ungrounded paths + commands + routes
            S->>S: enforce six kinds, order, rank order, dedupe
            S->>S: store tour + provenance (replaces previous)
            S-->>U: new tour
        end
    end
```

**e2e coverage:** one new agent-browser flow is warranted, as
`e2e/specs/NN-onboarding-tour.flow.json` — read-only, in the same shape as the existing
`06-onboarding.flow.json`: open a seeded repository's tour route, assert the six section
headings render, assert the `ON THIS PAGE` list has six entries, and assert a known command row,
a known critical-path row, and a known route entry are present. It must **not** trigger
`Regenerate` (that would
spend a real model call against the e2e stack). The existing `06-onboarding.flow.json` stays as
it is and continues to cover the add-repository screen; the new flow's name must make the
distinction obvious so the two are never confused.

## Contracts

Shapes only — field names are indicative, not prescriptive. The existing
`Onboarding` / `OnboardingSection` / `OnboardingLink` shapes in `@devdigest/shared` are the
starting point; the change is that a section gains a typed payload alongside its prose.

**Tour (server → client):**
- `sections` — exactly six, ordered, one per kind (AC-1)
- `generated_at` — timestamp, required (AC-25)
- `indexed_revision` — the index revision the tour was generated from, required (AC-25, AC-29)
- `indexed_file_count` — integer, required; drives the design's subtitle (AC-25)
- `provider`, `model` — the resolved feature-model choice, required (AC-4, AC-25)
- `state` — one of `ready` | `generating` | `failed` | `not_indexed`, required
- `stale` — boolean; true when the repository's current indexed revision differs (AC-29)
- `degraded` — optional; present with a reason when generated from a partial/degraded index (AC-7)
- `failure_reason` — optional; present when `state` is `failed` (AC-28)

**Section (server → client), discriminated by `kind`:**
- `kind` — one of `architecture` | `critical_paths` | `routes_and_apis` | `local_setup` |
  `reading_path` | `first_tasks`, required (AC-1)
- `title` — string, required
- `body` — markdown; required and non-empty for `architecture`, optional elsewhere (AC-13)
- `diagram` — mermaid source; permitted **only** on `architecture` and `routes_and_apis`, null
  on the other four (AC-13)
- `empty_reason` — optional; e.g. `insufficient_grounding`, set when the section has no items
  (AC-10, AC-11)
- `facts_unavailable` — optional, `routes_and_apis` only; set when the index carried no endpoint
  facts to check entries against (AC-52)
- `items` — the typed payload, whose element shape depends on `kind`:
  - `critical_paths`: `{ path, why }`, ordered by rank (AC-15, AC-16)
  - `routes_and_apis`: `{ surface, group, method, route, source_path, note }` where
    `surface ∈ frontend | api`, `group` is the area the entry belongs to (free text supplied by
    the model, e.g. `agents`, `pulls`, `repos`), `method` is an HTTP method and is null for a
    frontend route, `route` is the route or path pattern, `source_path` is the declaring file and
    is **required** (AC-51), and `note` is an optional one-liner. Unique by
    `surface + method + route` (AC-49, AC-53)
  - `local_setup`: `{ command }`, ordered, one command per element (AC-18)
  - `reading_path`: `{ path, rationale }`, ordered, paths unique (AC-19, AC-20)
  - `first_tasks`: `{ title, target, complexity }` where `complexity ∈ low | medium | high`
    (AC-21, AC-22)
  - `architecture`: no items

`routes_and_apis` is the one section that carries **both** an optional diagram and typed items,
which is why it is worth stating explicitly that it is *not* prose-plus-diagram. It was
considered as prose — it is the section whose existing prompt guidance is the most narrative,
and it is the only section with no screenshot forcing the issue. It is rejected for the same
reason every other list section is typed: the design intent is grouped, scannable route entries
(AC-50), grouping and de-duplicating them client-side requires the surface, area, method, and
route as separate fields, and AC-51/AC-52's grounding checks need `source_path` and
`method + route` as data the server can compare against index facts. A markdown blob makes all
four of those impossible, and would leave the one section most likely to contain invented
endpoints as the only one nothing can verify.

**Compatibility note for whoever writes the contract:** these are *model-facing* shapes. A field
given a Zod `.default(...)` in a contract passed as the structured-output schema emits a
`"default"` keyword that OpenAI's strict structured-output mode rejects, and the field still
lands in `required` — so model-facing fields must be plain and required, with the leniency
expressed in the prompt instead. Conversely, a `.default(...)` on the *stored/served* shape
makes the field required in the inferred output type, which ripples into every hand-built test
fixture of that type across `client` and `server`. Both of these are recorded gotchas in this
repository, and both apply directly to this contract.

**Regeneration request (client → server):**
- repository reference, required. No body beyond that — the section set is not user-selectable
  (Non-goals).

**Regeneration response (server → client):**
- `state` — `generating`, required (AC-26)
- `job` — the identity of the in-flight generation, required; the same identity is returned for a
  request that joined an existing job (AC-27)

**Prompt template (existing file, minimally changed):**
- `{{sections}}` is filled from a server-side constant naming the **six** kinds of AC-1, in the
  order of AC-1.
- The `routes_and_apis` section, its "Frontend routes / API endpoints" formatting block, its
  group-by-area instruction, and its diagram permission are **retained as written** (AC-2). The
  template's existing sentence granting diagrams to `architecture` and `routes_and_apis` is
  already exactly the two-section permission AC-13 requires — it needs no edit.
- The mermaid rules, the grounding rules, the SECURITY paragraph, and `{{language}}` are kept
  verbatim — they already encode the behaviour AC-8, AC-12, AC-13, and AC-14 require.
- The only change the template needs is whatever is required to have the model emit the typed
  items of the *Section* contract above rather than a markdown `body` for the five list
  sections. Everything else in the file stays.

**Stored record (existing table, shape of its payload changed):**
- The `onboarding` table's keying (`repo_id` primary key) and `generated_at` already match AC-24
  and AC-25. Its `json` payload carries the tour above; the provenance fields of AC-25 that the
  table does not already have as columns live in that payload or beside it. The table is empty
  today, so there is no migration of existing data to consider.

**Feature-model slot (existing, newly consumed):**
- `FEATURE_MODELS`' `onboarding` entry is read via the existing per-feature resolution
  (workspace override, else registry default). No contract change (AC-4).

**Navigation (existing, extended):**
- The workspace nav group gains an `onboarding-tour` item with a repo-templated href, positioned
  between `pulls` and `context` (AC-34). Its label key already exists in the shell catalogue.

## Untrusted inputs

**Yes — every input to generation and every output of it is untrusted.**

- **Input.** Manifests, task files, README text, and key-file excerpts come from a third-party
  repository. Anyone who can land a commit there can attempt to steer the generating model.
  Every excerpt is delimiter-wrapped before it reaches the prompt (AC-12), following the
  precedent already in `conventions/service.ts:246`, and the system prompt already carries the
  rule that content inside those delimiters is data and never instructions. Defence is the
  trusted-rule-plus-wrapper design, **not** keyword scanning; this feature must not introduce a
  denylist over repository content.
- **Output.** The model's response is untrusted a second time over, because it is derived from
  untrusted input. It is therefore never taken at its word:
  - paths are checked against the index and the clone before storage (AC-8);
  - commands must be attested by a real file in the repository (AC-9);
  - routes must name a declaring file that exists, and are checked against the index's extracted
    endpoint facts wherever those exist (AC-51, AC-52);
  - section kinds, order, surfaces, and complexity values are constrained to closed sets (AC-1,
    AC-22, AC-49);
  - the ordering of `critical_paths` comes from the deterministic file rank, not from the
    model's preference (AC-16), and `routes_and_apis` ordering is deterministic (AC-53).

  `routes_and_apis` deserves specific mention here: an invented endpoint is the most *plausible*
  and most *actionable* thing this feature could get wrong. A fabricated file path wastes a
  minute; a fabricated `POST /admin/users` route sends a new joiner looking for an authorisation
  surface that does not exist, or worse, reads to them as documentation that one should. That is
  why AC-51 refuses to render a route that cannot name its declaring file, rather than showing it
  with a caveat.
- **Rendering.** Model-written markdown renders through the shared component that does not enable
  raw HTML, so an embedded `<script>` becomes escaped text rather than a DOM element (AC-43).
  Diagrams render through the existing validate-then-render mermaid component (AC-14). Link
  schemes are restricted (AC-45).
- **Commands are never executed.** A `local_setup` command is text authored by a model reading
  third-party content. It is copyable and nothing else — no run button, no terminal integration
  (AC-44). This is the single sharpest edge in the feature: the design's most convenient
  affordance would be a run button, and it must not exist.
- **No new read surface.** `Share link` deliberately mints nothing (AC-40); a public link would
  expose a private repository's structure and file excerpts through an endpoint with no
  authentication to check, given the `LocalNoAuthProvider` MVP.
- `groundFindings()` is not involved — this feature produces no findings and does not enter the
  review pipeline — but the same principle drives AC-8 through AC-10: an assertion that cannot
  be tied to something real is dropped, not softened.

## Open questions

### Resolved — decided by the user on 2026-08-19

All four blocking decisions were put to the user. **One was overturned**; the other three were
confirmed as proposed, so the spec stands as written on those.

- **(a) The section set — OVERTURNED. Six sections, `routes_and_apis` kept.** Three competing
  five-section sets existed: the shipped prompt's (which includes `routes_and_apis`), the message
  catalogue's ("overview, architecture, key modules, getting started, conventions & gotchas"),
  and the request's. The spec originally defaulted to the request's five and deleted
  `routes_and_apis` from the prompt. **The user rejected that and chose to keep
  `routes_and_apis` as a sixth section**, third in the order. Consequences now written into the
  spec: six sections in a fixed order (AC-1); the existing prompt's `routes_and_apis` guidance is
  retained verbatim rather than deleted (AC-2); **two** sections may carry a mermaid diagram
  (AC-13, AC-14); the section contract gains a `routes_and_apis` arm with typed grouped entries
  (AC-49 to AC-53); the page and its `ON THIS PAGE` list carry six cards and six entries (AC-11,
  AC-36); the stale catalogue copy is corrected to the six-section set (AC-41); and the generation
  budgets were raised for the extra section. The set remains a server-side constant, not a user
  setting — the "configurable set" alternative stays rejected as scope.
  **This puts the spec one section ahead of the design sources**: the screenshots show five cards
  and a five-entry table of contents. That divergence is deliberate and is called out in
  *Problem & why* and at each screenshot-derived criterion, so nobody downstream reads the sixth
  card as a fidelity failure.

- **(b) `Share link` copies an in-app deep link — CONFIRMED by the user.** DevDigest's auth MVP
  is `LocalNoAuthProvider` — there is no authentication, no user model, and no sharing
  infrastructure. A "public share" would mean minting an unauthenticated endpoint that serves a
  private repository's file paths and excerpts, and would need tokens, revocation, expiry, and
  its own rate limit. `Share link` is a clipboard copy of the page's own URL with a section
  anchor (AC-40); public sharing is a Non-goal and, if wanted, is a separate spec with its own
  threat model.

- **(c) `Regenerate` runs in the background — CONFIRMED by the user.** Precedent in this codebase
  is split: `conventions/extract` runs a single model call inline and the user waits, while
  `repos/:id/resync` returns 202 and enqueues a `JobRunner` job. The tour follows `resync`: a
  background job with the previous tour left readable (AC-26, AC-27), which also makes the
  in-flight dedupe natural. The extra state machine is accepted.

- **(d) Staleness marks, never auto-regenerates — CONFIRMED by the user.** The tour records the
  indexed revision it was generated from and shows a stale marker once the repository has been
  re-indexed past it (AC-29), but never spends a model call without a human asking (AC-31).
  Rejected alternatives: regenerating on every completed re-index (polling-driven resyncs would
  silently spend a model call per repository) and a time-based TTL (decoupled from whether
  anything actually changed).

### Still open — non-blocking

- [NEEDS CLARIFICATION: **How many items per section?** The design shows four critical paths,
  four commands, three reading-path steps, and three tasks — and, having no screenshot, says
  nothing about routes. The spec deliberately leaves the counts as configuration with a minimum
  threshold (AC-10) rather than fixing them, because the right number depends on repository size.
  Confirm the defaults before implementation — suggested: critical paths 4–8, commands unbounded
  but ordered, reading path 3–7, first tasks 3–5, and **routes capped per surface** (suggested 12
  frontend routes and 24 API endpoints, grouped) with an explicit "showing N of M" affordance.
  The routes cap is the one that actually bites: a mid-sized service declares far more endpoints
  than fit on an onboarding card, and an uncapped inventory turns the tour's third card into a
  wall of text that nobody reads and that crowds the generation budget.]

- [NEEDS CLARIFICATION: **Endpoint facts are not exposed as a general facade read.** AC-52 checks
  API entries against the index's extracted endpoint facts, and `repo-intel` genuinely extracts
  them (`"METHOD /path"`, documented on the blast-radius result). But the facade surfaces them
  only *scoped to a set of changed files*, as a by-product of the blast-radius read — there is no
  "list this repository's endpoints" method. Decide between adding one small facade read
  (cleanest, and the facade is the only permitted door into `repo-intel`) or living on AC-52's
  `facts_unavailable` fallback, which grounds routes on the declaring file alone and leaves the
  route string itself unverified. Recommendation: add the facade read — without it, the section
  most likely to contain a plausible invention is also the least checkable.]
- [NEEDS CLARIFICATION: **Where does `first_tasks` complexity come from?** The spec constrains it
  to a closed three-value set and drops anything else (AC-21, AC-22), but the *value* is the
  model's judgement — nothing in the index measures task difficulty. A deterministic signal
  (target file rank, file size, caller count, test coverage of the target) could either replace
  or sanity-check the model's badge. Worth deciding, because a badge that is pure model opinion
  is the least grounded thing on the page, and it is the thing a new joiner will trust most.]
- [NEEDS CLARIFICATION: **Language of the generated tour.** The existing prompt carries a
  `{{language}}` placeholder. There is no workspace language setting feeding it today. Confirm
  whether this follows the client locale, a new workspace setting, or is pinned to English for
  now.]
- [NEEDS CLARIFICATION: **`Open` targets the provider, not DevDigest.** AC-38 opens the file on
  the hosting provider at the indexed revision, reusing the existing blob-URL construction. An
  in-app file viewer would keep the user on the page and would work for a repository whose
  provider is unreachable, but no such viewer exists. Confirm the provider link is acceptable for
  now.]
- [NEEDS CLARIFICATION: **`activeKeyFor` fix is a shared-surface change.** AC-33 corrects a
  pre-existing bug in the app shell's active-nav derivation that today mis-highlights on
  `/onboarding`. It is in scope here because this feature is what makes the bug visible, but it
  touches a helper shared by every route — flag it for extra care in review.]
