# Insights — `server`

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

- 2026-08-18 — `LocalReviewService` (`modules/reviews/local-review.ts`) builds
  its own `ReviewRepository` directly from `container.db`
  (`this.repo = new ReviewRepository(container.db)`), NOT via
  `container.reviewRepo` — so overriding `ContainerOverrides.reviewRepo` (the
  slot added for T11, see the `Codebase Patterns` entry on that override) does
  nothing for a hermetic test of this service; `getRepoByFullName`'s query
  still hits the real `container.db`. Faking just the one query shape this
  class issues is enough and needs no real drizzle instance: `db: { select: ()
  => ({ from: () => ({ where: async () => (row ? [row] : []) }) }) }` —
  arguments ignored, always resolves to a fixed row/`[]`. Used in
  `test/local-review-project-context.test.ts` (T18) to hermetically prove
  AC-28 (local review injects the identical `## Project context` section
  `resolveProjectContext` + `assemblePrompt` produce for the PR path) without
  Docker. Any future hermetic test of a `modules/*` service that instantiates
  a repository from `container.db` directly instead of a container getter
  needs this same minimal-chain-stub approach, not a container-override.

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

- 2026-08-20 — In `modules/project-context/service.ts`, a `context_attachments`
  row is NEVER by itself proof that `(repo_id, path)` is safe to read back out
  of a clone — it is only proof someone once called `setAgentContext`/
  `setSkillContext` for it, and (before the PAT-disclosure fix at `drift():497`,
  `confirm():532`, `buildAttachmentRows():337`) that call only required
  `resolveInClone` containment, not membership in `project_context_documents`
  (the scan's own allowlist). Any code path in this file that turns an
  attachment/ref into a filesystem read must re-check
  `this.repo.getDocument(repoId, path)` resolves, even on the `prior`
  (already-attached) fast path in `buildAttachmentRows` — a row persisted
  before this check existed must not be grandfathered in, or the fast path
  itself becomes the bypass. `preview()` had this check from the start; the
  other three methods didn't.
- 2026-08-20 — `JobRunner`'s `JobHandler` signature (`platform/jobs.ts:16`,
  `(payload, ctx: { jobId }) => Promise<void>`) never receives the
  `workspaceId` passed to `enqueue(workspaceId, kind, payload)` — it is
  written to the `jobs` row but NOT forwarded to the handler. A handler that
  needs it (e.g. `resolveFeatureModel(container, workspaceId, ...)`, which is
  workspace-scoped) must recover it another way. `modules/onboarding/
  service.ts`'s job handler does this by fetching the repo row via
  `container.reviewRepo.getRepo(repoId)` first (needed anyway for
  `fullName`/`clonePath`) and reading `.workspaceId` off it — this also kept
  the job's enqueue payload exactly `{ repoId }` as the plan specified,
  instead of duplicating `workspaceId` into the payload. `container.reviewRepo
  .getRepo(repoId)` (unlike `getRepoByFullName`, which IS workspace-scoped) is
  the established cross-module way to read a `repos` row by id without
  touching `db/schema` directly — `modules/project-context/service.ts:44`
  (`getWorkspaceRepo`) is the other precedent.
- 2026-08-11 — The repo-intel index is built from the repo's DEFAULT BRANCH
  only — `repo_index_state` is one row per repo with no sha dimension, and
  `resyncRepo` fetches `origin/<defaultBranch>`. So NOTHING a pull request adds
  (new functions, new routes, a new cron) exists in the index, and any
  PR-scoped read served purely from it silently omits exactly the code under
  review. `modules/repo-intel/head-overlay.ts` is the workaround: fetch
  `pull/<n>/head`, read only the changed files at that sha via
  `git.readFileAt`, parse in-memory, merge. Two limits worth knowing — it sees
  callers only in files the diff touches, and it resolves overlay references by
  NAME (a full import resolution would need the whole branch parsed).

- 2026-08-11 — NEVER apply a per-line regex to detect route registrations.
  `extractEndpoints` did, and any route whose path sits on the line after the
  verb — i.e. every route that takes a schema/options object, which in practice
  is all of them — was invisible. The visible symptom is inverted and very
  easy to misread: `file_facts` fills up with a repo's TEST files (one-liner
  `api.get('/x?limit=1000')` calls do fit on one line) while its real
  `routes.ts` files record nothing, so the endpoint list looks populated and is
  entirely wrong. Fixed by matching the whole source (`\s` spans newlines) and
  by excluding test files from `file_facts` (`repo-intel/helpers.ts`
  `isTestFile`) — a test calls INTO an API, it does not register one.

- 2026-08-11 — `extractCrons` only matched a cron literal sitting next to a
  `cron`/`schedule`/`CronJob` token, which misses every idiomatic way of
  hoisting the schedule out of the call — a `CRON_SCHEDULES` lookup table, a
  config default, a constant — because on the line holding the literal the
  keyword is gone. It now also recognises a quoted 5/6-field cron expression by
  its own grammar; across ~500 files of this repo that rule fired on nothing
  else. Job kinds are routinely kebab-case, so `[a-z][a-z0-9_]*` silently
  dropped every hyphenated one.

- 2026-08-11 — ALWAYS bump `INDEXER_VERSION` when changing what the extractors
  WRITE, not just when changing the symbol schema. `POST /repos/:id/resync` on
  an unchanged sha takes the incremental no-op path and never rewrites
  `file_facts`, so an extractor fix appears to do nothing; the version mismatch
  is the only thing that forces the full rebuild.

- 2026-08-11 — `references.to_symbol` is a BARE NAME, so `(file, name)` — not
  the name — is a symbol's identity anywhere blast-style attribution happens.
  Keying per-symbol maps on the name alone made `getById` in
  `articles/repository.ts` and `articles/service.ts` share one bucket: each
  rendered the union of both callers, and the totals double-counted. Carry
  `references.decl_file` through and key with `symbolKey(file, name)`.

- 2026-08-11 — ALWAYS pin a code link built from repo-intel data to
  `repo_index_state.last_indexed_sha`, **never** to the repo's default branch or
  the PR head sha. Every `file:line` the index emits (`symbols.line`,
  `references.line`, and so anything downstream like `BlastCallerRow.line`) is
  measured against the commit the indexer walked, and the index lags `main` by
  however many commits have landed since — so a `blob/main/...#L146` link drifts
  by however many lines were inserted above. Verified concretely: for the
  `deriveReviewStatus` caller in `server/src/modules/pulls/routes.ts`, line 146
  at the indexed sha is the real call site, while line 146 on `main` is an
  unrelated `.where(and(eq(...)))`. The PR head sha is wrong too — index callers
  mostly live in files the PR never touched. This is why
  `BlastRadiusResult.indexed_sha` exists
  (`server/src/vendor/shared/contracts/blast.ts`); any new surface over index
  data needs the same field rather than reusing `repo.default_branch`.

- 2026-08-07 — `server/src/prompts/intent.extract.md` (T3) has exactly seven
  placeholders (`title`, `branch`, `commits`, `paths`, `body`, `ticket`,
  `docs`) with **no dedicated slot for evidence tiers (d) external URLs or
  (e) Jira/Linear**, and the template is out of scope for whoever implements
  those tiers (T15/T16) since it's already accept-criteria-frozen. The
  working pattern (`modules/reviews/intent/service.ts`, the
  `INTENT_EXTERNAL_EVIDENCE` seam): fold tier-(d) fetched URL content into the
  existing `docsText` variable (same `{{docs}}` slot) and tier-(e) ticket
  content into `ticketText` (same `{{ticket}}` slot), both still individually
  `wrapEvidence()`-wrapped before concatenation. If a template placeholder set
  is ever frozen like this again, check whether new evidence sources are
  meant to widen the template or fold into an existing slot before assuming a
  template edit is needed.

- 2026-07-29 — Cost pricing is two-layered and the layers use **different model-id
  namespaces**. `PriceBook` (`platform/price-book.ts:54`) caches live OpenRouter
  prices keyed by `m.id` — OpenRouter slugs like `z-ai/glm-4.7-flash`. The static
  fallback (`adapters/llm/pricing.ts`) is keyed by bare ids like `gpt-4.1` and
  `claude-haiku-4-5`. So injecting `PriceBook` into the OpenAI/Anthropic adapters
  does **not** give them live pricing — their ids never match the live map and
  every lookup falls through to the static table. ALWAYS add a static entry when
  a non-OpenRouter model prices as `null`; wiring the PriceBook alone will not
  fix it.

- 2026-08-04 — ALWAYS pair a server-side "import/fetch this URL the user gave
  us" feature with an SSRF guard — resolve the hostname via `dns.lookup`
  *before* fetching, reject any resolved address that is loopback/private/
  link-local (including the `169.254.169.254` cloud-metadata address), only
  allow `http(s):`, and pass `redirect: 'manual'` so a redirect can't silently
  reach an unchecked host. Template: `isDisallowedIp()`
  (`modules/skills/helpers.ts`) + `SkillsService.fetchUrlBody()`
  (`modules/skills/service.ts`) — the skills URL-import route originally did a
  bare `fetch(url)` with no destination check, which is a ready-made SSRF (the
  fetched response body is returned to the caller, so it doubles as response
  reflection) caught in self-review, not by any test. Any future "paste a URL"
  feature in this codebase should reuse or mirror this pair rather than calling
  `fetch()` on user input directly.

- 2026-07-30 — `pnpm db:seed` creates a review with **no `run_id` and no
  `agent_id`**, and inserts **no `agent_runs` rows at all** (`db/seed.ts:136-148`
  — grep `runId` there returns nothing). So anything that joins reviews ↔ runs on
  `run_id` renders empty on freshly seeded data while working perfectly on real
  reviews, which `run-executor.ts` does link. NEVER debug such a feature against
  the demo PR — run a real review, or check a genuinely imported repo, before
  concluding the join is broken. (Hit while adding the per-run findings breakdown
  to the PR timeline: seeded PRs silently fell back to the plain count.)

- 2026-08-08 — There is NO identifier shared across one "Run Review (all
  agents)". `ReviewService.runReview` calls `createAgentRun` inside the
  per-agent loop, so every agent gets its own `agent_runs.id` and writes its own
  `reviews` row seconds apart. Two consequences for any feature reading "the
  latest review": `reviewsForPull(prId)[0]` is whichever agent's write landed
  LAST — routinely one that found nothing (observed: rows at 19:58:06 with 0
  findings, 19:58:01 with 0, 19:57:40 with 8) — and grouping by `run_id` does
  NOT repair it, because each of those rows has a different run id. ALWAYS
  de-duplicate by `agentId` newest-first instead (`findingsFromLatestRunPerAgent`
  in `modules/reviews/helpers.ts`): one vote per agent, a re-run supersedes only
  that agent. Taking every row is the opposite error — it double-counts re-runs.

- 2026-08-08 — Adding a new derived field to `pr_intent` does NOT backfill on the
  next review run. `IntentService.deriveForRun` short-circuits on
  `cached.headSha === pull.headSha` (`modules/reviews/intent/service.ts:126`)
  and returns the persisted row without calling the model, so every PR whose
  head hasn't moved keeps the old shape — the new column sits at its DB default
  forever and re-running the review changes nothing. ALWAYS state this when
  shipping such a field, and force a re-derive with
  `DELETE FROM pr_intent WHERE pr_id = …` (or push a new commit) rather than
  debugging why the value is empty. Hit shipping `risk_areas`.
  └ 2026-08-09 update: there is now a supported escape hatch —
    `POST /pulls/:id/intent/recalculate` force-derives one PR at the same
    `head_sha` (`IntentService.recalculate`, which skips the cache check that
    `deriveForRun` still performs). Prefer it over `DELETE FROM pr_intent` for
    a handful of PRs; the SQL is still the move for a bulk backfill, since the
    endpoint is one PR per call and rate-limited.

- 2026-08-18 — When a field on `agent_versions.config_json` is NOT a column on
  `agents` (e.g. the ordered project-context attachment list, AC-19 —
  `AgentVersionConfig.context`), `AgentsRepository.snapshotVersion` cannot read
  its "current value" from the `agents` row the way it does for
  provider/model/prompt. The pattern that keeps every snapshot correct without
  a second data source: `lastContext(agentId)` reads the field off the MOST
  RECENT `agent_versions` row (via `AgentVersionConfig.safeParse`, `[]` if none
  exists or it predates the field) and `snapshotVersion` carries that forward
  by default on every unrelated config bump (rename, prompt edit, …) — only
  `bumpVersionWithContext` overrides it explicitly with a freshly-computed
  list. Skipping this and defaulting to `[]` unconditionally would silently
  wipe an agent's attachment list off the NEXT unrelated edit's snapshot.
  `modules/skills/repository.ts` (T16, AC-39/AC-42) needs the identical
  carry-forward shape for its own attachment field — reuse this pattern rather
  than re-deriving it.

- 2026-08-18 — A "set the full attachment/config list" service method
  (`ProjectContextService.setAgentContext`/`setSkillContext`,
  `modules/project-context/service.ts`) must NOT blindly recompute a fresh
  snapshot (hash/size/revision) for every ref in the incoming list, even
  though `ProjectContextRepository.replaceAttachments` is a delete-then-insert
  full replace. AC-35 defines the recorded hash as "at attach time" — the
  moment a ref FIRST becomes attached — so a naive implementation that
  re-reads the current file for every ref on every save silently re-stamps
  every already-attached document as freshly attached on each unrelated
  change (e.g. adding one more document), wiping out AC-36's drift marker for
  every doc that had actually drifted. The fix: diff the incoming ref list
  against the owner's EXISTING attachment rows first; a ref already present
  keeps its previously recorded hash/size/revision verbatim, and only a
  genuinely new ref gets a fresh read. Any future "replace the whole set"
  operation over an "recorded at attach/create time" semantic should diff
  against the prior state the same way, not just re-derive fresh values for
  the new list wholesale.

- 2026-08-18 — `ProjectContextService` (T9) has NO read-side method for a
  skill's own attachment list — only `setSkillContext` (write) and
  `effectiveContext(agentId)` (agent-scoped, merges in linked skills' docs,
  wrong shape for "this skill's own ordered attachments"). T11's
  `GET /skills/:id/context` needed exactly that shape
  (`ProjectContextAttachment[]`) and `service.ts`/`repository.ts` were both
  out of T11's owned paths ("already landed, do NOT edit"). Resolved by
  adding `Container.projectContextRepo` (`platform/container.ts`) — a lazy
  getter exposing `ProjectContextRepository` directly, mirroring the existing
  `agentsRepo`/`skillsRepo`/`reviewRepo` shared-repository pattern — and
  having `project-context/routes.ts` call it directly for that one endpoint
  only, with drift computed inline (`attached_hash` vs. the document's
  current `content_hash`, the same comparison `ProjectContextService`
  performs internally). This is a deliberate, documented onion-rule
  exception (Transport → Infrastructure, skipping Application) — a follow-up
  should add `ProjectContextService.skillContext(skillId)` and switch the
  route to call that instead, then this getter's route-layer use can retire
  (the getter itself may still be useful for other cross-module reads).

- 2026-08-18 — `ContainerOverrides` had NO override slot for `agentsRepo`,
  `skillsRepo`, or `reviewRepo` before T11 — every consumer got the real,
  DB-backed instance unconditionally (`platform/container.ts`'s three
  getters had no `if (this.overrides.x)` branch, unlike `git`/`codeIndex`/
  `repoIntel`/etc.). This blocked writing a hermetic (`app.inject()`, no
  Docker) route-smoke test for anything that needs to assert a
  cross-workspace 404 by faking "this repo/agent/skill belongs to a
  different workspace" — the real repositories need a live DB to answer
  that at all. Added override branches for all three (backward compatible:
  omitting the override keeps today's real-DB construction) in T11
  specifically to test `modules/project-context/routes.ts`'s workspace
  checks; any other module needing the same kind of hermetic ownership-check
  test can now reuse the same overrides instead of rediscovering this gap.

- 2026-08-18 — When ONE save must combine two independently-triggered change
  reasons (body diff vs. ordered attachment-set diff) into AT MOST ONE version
  snapshot, don't copy `AgentsRepository`'s split-call shape verbatim —
  `ProjectContextService.setAgentContext` calls `agentsRepo.bumpVersionWithContext`
  as a SEPARATE call/decision from whatever else changed the agent that save,
  so a body-and-attachments edit in one PUT there can in principle still
  produce two agent_versions rows if a caller ever combined them (it doesn't
  today, but the seam exists). `SkillsRepository.update` (T16, AC-39/AC-42)
  needed the opposite shape: ONE `isConfigChange` call folding `body` AND
  `context` together, evaluated and written inside a SINGLE
  `this.db.transaction(...)` alongside the `skills` UPDATE and the
  `skill_versions` INSERT — so "did anything change" is decided exactly once
  per save. `ProjectContextService.setSkillContext` deliberately has NO
  version-bump side effect (unlike `setAgentContext`) specifically so the
  repository stays the single decision point; the service calls
  `setSkillContext` (writes `context_attachments`, the read-side source of
  truth) BEFORE calling `repo.update` (writes `skill_versions`, the
  version-history embed) — order doesn't matter for the change-detection
  math, since `SkillsRepository.lastContext` reads the LAST `skill_versions`
  snapshot's `attachments`, never the live `context_attachments` table.

- 2026-08-18 — `Container.projectContextRepo` (`platform/container.ts`) has NO
  `ContainerOverrides` slot — unlike `agentsRepo`/`skillsRepo`/`reviewRepo`,
  its getter unconditionally does `new ProjectContextRepository(this.db)`
  against the container's real `db` field, so there is no way to inject a
  fake for it through `buildApp({overrides})`/route-smoke-style tests. T15's
  `resolveProjectContext` (`modules/reviews/prompt-context.ts`) needs exactly
  this repo (`getAttachment`, for AC-44's attach-time-hash comparison) in a
  hermetic unit test with no DB. The fix, not a container change: build a
  wholly fake `Container` object via `as unknown as Container` — same
  pattern as `test/repo-intel-resync.test.ts:43-48` — with `projectContextRepo:
  { getAttachment: async () => ... }` as a plain property; this bypasses the
  real class entirely, so the missing override slot doesn't matter. Prefer
  this cast-a-plain-object pattern over `new Container(...)` for any
  hermetic unit test that needs a function taking `container: Container` but
  touches a getter with no override branch.
  └ 2026-08-19 correction: the override slot now exists
    (`ContainerOverrides.projectContextRepo` + the getter's `if
    (this.overrides.projectContextRepo) return …` branch, `platform/
    container.ts`), added as part of moving `GET /skills/:id/context`'s
    response assembly off this getter and into
    `ProjectContextService.skillContext()` (an onion-layering fix). The
    getter itself was kept, not deleted, because `resolveProjectContext`
    (`modules/reviews/prompt-context.ts:290`) is still a real, legitimate
    caller — reaching it via `container.projectContext` (the service) would
    have meant reading through a sibling module's write-oriented API for a
    single-row lookup. The cast-a-plain-object pattern above still works
    fine and needs no change; the override now also works for anyone
    constructing a real `Container`.

- 2026-08-19 — ALWAYS put a caller-workspace ownership check on a shared
  "replace the full attachment/ref set" service method itself, not only on
  the one route that currently calls it. `ProjectContextService.setAgentContext`
  had its `refs[].repo_id` workspace check ONLY in `project-context/routes.ts`'s
  `assertRefsInWorkspace`, called before `PUT /agents/:id/context` reaches the
  service. `SkillsService.update` (`modules/skills/service.ts`) reaches the
  identical service method (`setSkillContext`) through a completely different
  door — no route-level check of its own — and shipped with zero validation
  of `patch.context[].repo_id`, letting a skill in workspace A attach (and,
  via `GET /skills/:id/context`, read back the hash/size/HEAD-sha of) a file
  out of workspace B's repo clone. Found and confirmed as a CRITICAL in
  self-review, not by any test. Fixed by moving the check INTO
  `setAgentContext`/`setSkillContext` (both now take `workspaceId` and run a
  shared `assertRefsInWorkspace` before touching the repository), keeping the
  route-level check as defence in depth rather than removing it. The general
  rule: when a service method is reachable from more than one route/module,
  a security check belongs on the method itself — a route-level guard only
  protects the route that happens to have one.

- 2026-08-20 — `groundTour`'s `critical_paths` grounding (`modules/onboarding/
  helpers.ts`, T8) checks membership in the `rank` argument ONLY — it never
  falls back to `evidence.fileExists` the way `reading_path`/`first_tasks` do.
  This is deliberate: AC-16 requires the STORED order to be derived from rank
  (never the model's order), and a path present in the clone but absent from
  `rank` has no legitimate derived position, so keeping it would mean silently
  falling back to the model's order for that one item — exactly what AC-16
  forbids. The consequence for T10 (the facade that builds `rank` from
  `repoIntel.getTopFilesByRank`/`getCriticalPaths`): a `rank` list that's too
  narrow (e.g. only the top 5 files) will make otherwise-legitimate,
  real critical-path candidates the model cites vanish from the tour
  entirely, with no `empty_reason` explaining why beyond the generic
  `insufficient_grounding` if too few survive. Pass a `rank` that reasonably
  covers the repo, not a minimal top-N.

- 2026-08-20 — `groundTour`'s AC-52 endpoint-fact check (`modules/onboarding/
  helpers.ts`, T8) applies ONLY to `routes_and_apis` items with
  `surface === 'api'`. `frontend` entries are grounded on declaring-file
  existence alone (AC-51) and are NEVER checked against `endpointFacts` —
  those facts are backend "METHOD /path" strings extracted from Fastify-style
  route registrations and would never match a frontend route regardless of
  its validity. Reading AC-52's "API entry" as "any `routes_and_apis` entry"
  would incorrectly drop every frontend route whenever the repo has ANY
  endpoint facts at all.

- 2026-08-20 — `groundTour`'s AC-22 complexity check (`modules/onboarding/
  helpers.ts`, T8) re-validates `item.complexity` against the permitted enum
  at RUNTIME (`PERMITTED_COMPLEXITY.has(item.complexity as string)`) despite
  `OnboardingFirstTask.complexity` being statically typed as the closed union
  `'low' | 'medium' | 'high'` — because the value reaching `groundTour` is
  ultimately LLM structured output, which is not guaranteed to actually
  respect the schema it was asked to follow at runtime even though the
  TypeScript type (correctly, for a well-formed caller) says otherwise. Same
  general lesson as the `.default([])`-in-structured-output gotcha
  (`gotchas.md`, 2026-08-08): a zod-inferred type describes the INTENDED
  shape of model output, not a runtime guarantee — any grounding/validation
  layer sitting between a structured-output call and storage needs its own
  runtime check for the exact things its acceptance criteria care about, cast
  or no cast.

- 2026-08-20 — `OnboardingLink` (`{label, path}`) sits on EVERY onboarding
  section, including `architecture` (which has no item array at all), and is
  a "cited file path" just like `critical_paths`/`reading_path` entries — AC-8
  ("drop any cited file path neither indexed nor resolvable in the clone") is
  written broadly enough to cover it, even though the T8 task brief's ordered
  bullet list for `groundTour` only enumerated the five typed item arrays and
  never mentioned `links`. `groundTour` (`modules/onboarding/helpers.ts`) now
  grounds `links` on all six kinds via a shared `groundLinks()` (rank OR
  file/dir-exists, directory allowed like AC-23) — deliberately NOT wired
  into `emptyReasonFor`/AC-10, since losing every link on an otherwise
  well-grounded section must not mark it `insufficient_grounding`. General
  lesson: when a plan enumerates specific fields to ground/validate but the
  underlying AC text is written in terms of a broader category ("any cited
  file path", not "any item in these five arrays"), check the full contract
  for every field of that shape before treating the enumerated list as
  exhaustive — an omission in the plan's bullet list is not evidence of a
  deliberate carve-out.

- 2026-08-20 — When a `planBudget`-style function has TWO callers that must
  agree on the exact same `dropped` list for "the same input" (AC-40's
  preview vs. AC-23's run-time drop, `_shared/context-budget.ts`), "the same
  input" means the identical, UNFILTERED candidate set — never a
  budget-planning call over a subset one caller pre-filtered (e.g. dropping
  `wrong_repo`/`missing` documents before budgeting) while the other budgets
  over the full set. `modules/reviews/prompt-context.ts::resolveProjectContext`
  used to filter first, which let an excluded document's tokens silently
  "free up" budget space the preview (`ProjectContextService.effectiveContext`)
  had already counted as spent — so the preview's `dropped_paths` and the
  run's `dropped_over_budget` set could name different documents for the
  same effective set (pre-PR gate finding). Fixed by running `planBudget`
  FIRST over the full set, then determining `wrong_repo`/`missing` as a
  SEPARATE, later step that overrides a budget-`injected` verdict (never the
  reverse) — the existing `outcomePrecedence`/`resolveOutcome` machinery in
  `project-context/helpers.ts` already models exactly this "which fact wins
  when several apply to one document" shape; reuse it (or its ordering)
  rather than filtering before planning.

- 2026-08-20 — When two DIFFERENT modules' repositories must stay consistent
  (one write per module, no shared DB transaction available) — e.g.
  `SkillsService.update` writes `context_attachments` via
  `container.projectContext.setSkillContext` (its own transaction) THEN
  `skills`/`skill_versions` via `SkillsRepository.update` (a separate
  transaction) — a failure in the SECOND write after the FIRST already
  committed is not fixable by wrapping both in one transaction (the two
  repositories don't share a `Db`/`tx` handle, and reaching into the other
  module's repository to write its table would violate the "one file owns
  this table" rule `ProjectContextRepository`'s header documents). The fix
  is a compensating write: snapshot the pre-write state via the OTHER
  module's own read method (`ProjectContextService.skillContext`) before
  overwriting it, and on failure replay the SAME write method
  (`setSkillContext`) with that snapshot. This works cleanly specifically
  because the write is a full delete-then-insert
  (`ProjectContextRepository.replaceAttachments`) — replaying with the prior
  ref list reproduces the exact prior `(repo_id, path)` set with no orphaned
  row, even though a ref that has to be re-created picks up a fresh
  attach-time hash/revision rather than its original one (an accepted,
  narrow imperfection confined to an already-rare failure path). Generalize:
  a cross-module consistency fix reaches for "read current state via the
  other module's public API, write, and on failure replay the same public
  API with the saved state" before reaching for a shared transaction that
  may not be achievable without a layering violation.

- 2026-08-20 — `modules/reviews/brief/summaries.ts::selectFilesToSummarize`
  (T6) takes `findingCounts: ReadonlyMap<string, number>` keyed by file
  `path`, with an absent path treated as `0` findings (`findingCounts.get(file.path)
  ?? 0`) — the plan's own text (`selectFilesToSummarize(files, findingCounts)`)
  left the exact type unspecified. Chosen to match the `ReadonlyMap<string,
  string>` shape T14 already specifies for `buildSmartDiff`'s `summaries`
  parameter (`smart-diff/classify.ts`), so both per-path caller-supplied maps
  in this feature share one convention. T12's `generateFileSummaries(pull,
  files, findingCounts, logger)` must build/pass a `ReadonlyMap<string,
  number>` (e.g. from `findingsFromLatestRunPerAgent`'s grouped results) to
  match this signature, not an object/record keyed by path.

- 2026-08-20 — `IntentService.recalculate` (`modules/reviews/intent/service.ts`)
  resolves to `PromptIntentSlot` only (`statement`/`inScope`/`outOfScope`/
  `confidence`) — it never returns the derivation's tokens/cost/provider/
  model, unlike `derive`'s internal `res` which has all four. A caller that
  needs that provenance (T12's `BriefService.generate`, which sums the
  intent call's cost with the file-summaries call's cost into `pr_brief`'s
  single `tokens_in`/`tokens_out`/`cost_usd`) must `await recalculate(...)`
  first, then separately `await reviewRepo.getIntent(pull.id)` to read back
  what `derive` just persisted to `pr_intent` — there is no other way to get
  at those numbers without widening `PromptIntentSlot` (which would leak
  provenance into the prompt-slot shape every reviewer prompt consumes).

- 2026-08-20 — `pr_brief.provider`/`model` (T12, `brief/service.ts::doGenerate`)
  is a single string pair even though `generate()` makes two model calls
  resolved from two INDEPENDENT Settings entries (`review_intent` for the
  intent re-derive, `risk_brief` for the file summaries) that a workspace can
  legitimately point at different providers/models. Decided: the
  `risk_brief`/summaries call's provider/model wins when that call actually
  ran; the intent call's is the fallback (so the column is never both-null
  when at least one call spent tokens) — never blank, never a delimited
  "both" string. The intent call's own provider/model is separately and
  fully recorded on `pr_intent`, so nothing is lost by this simplification.
  └ 2026-08-21 correction: superseded — `generate()` now makes ONE model
    call (the `risk_brief` file-summaries call), so `pr_brief.provider/model`
    is simply that call's pair; there is no fallback to the intent call
    because the brief never makes one (see the next entry).

- 2026-08-21 — The PR Brief is built from ARTIFACTS, never the diff. ALWAYS
  keep `brief/service.ts::generate` at exactly ONE `completeStructured` call:
  the intent is READ from `pr_intent` (`reviewRepo.getIntent`) and passed to
  the model as an input; NEVER call `IntentService.recalculate` from the
  brief — re-deriving intent is `POST /pulls/:id/intent/recalculate`'s job,
  a separate, separately rate-limited endpoint. NEVER pass `pr_files.patch`
  into the brief prompt: `brief/evidence.ts` (pure) is the only renderer of
  the model's input and its input type has no `patch` field on purpose; it
  takes the intent, `container.blast.blastForPull` (read best-effort inside
  generation — a throw becomes "unavailable", never a failed brief), grouped
  diff stats via `classifyPath`, and finding titles. Budget is pinned by
  `BRIEF_EVIDENCE_MAX_CHARS` (30 000) with a saturated-worst-case unit test
  in `test/brief-evidence.test.ts` (measured 29 077 chars ≈ 7.3k tokens) —
  change a cap, re-measure, update the constant's comment.
  `POST …/brief/generate` is idempotent for the current head unless
  `?force=true` (`routes.ts::BriefGenerateQuery`).

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

- 2026-08-18 — `client/src/lib/hooks/project-context.ts`'s
  `useDocumentPreview` calls `GET /repos/:id/context/preview?path=…`, but the
  T11 task brief's "canonical route surface" (marked authoritative) and the
  server route actually registered is
  `GET /repos/:id/context/documents/preview?path=…` (note the extra
  `/documents` segment — it matches `.../context/documents` +
  `.../context/documents/preview` sharing a prefix, same shape as
  `.../context/drift` and `.../context/confirm` sitting directly under
  `.../context`). Every other client hook in that file (drift, confirm,
  agent/skill context) matches the server exactly. Whoever wires up the
  Project Context preview panel in the client needs to fix this one hook's
  URL (add `/documents`) or the preview call will 404 against the real
  server.

- 2026-08-07 — `modules/reviews/repository.ts` (the `ReviewRepository` facade)
  exposes `getPrFiles(prId)` but has **no `getPrCommits`/equivalent for
  `pr_commits`**, even though `pr_commits` is a first-class table with its own
  schema (`db/schema/pulls.ts`). `IntentService.deriveForRun`
  (`modules/reviews/intent/service.ts`) needs commit messages for tier-(a)
  evidence and, lacking a facade method, queries `schema.prCommits` directly
  via `container.db` — the same class of shortcut `pulls/routes.ts` already
  takes for the same table (both are on the onion-architecture skill's known
  `warn` drift list for touching `db/schema` outside a repository). Worth
  adding a `getPrCommits`/`getCommitMessages` method to `ReviewRepository` (or
  a shared one both modules can use) so this doesn't need re-deciding next
  time something in `reviews/` needs commit data.
  └ 2026-08-08 resolved: `getPrCommits(prId)` added to
    `modules/reviews/repository/pull.repo.ts` + exposed on the
    `ReviewRepository` facade, and `IntentService.deriveForRun` now calls
    `this.repo.getPrCommits(pull.id)` instead of querying `schema.prCommits`
    directly. `pulls/routes.ts:269`'s identical shortcut is untouched — it
    remains the one still-open instance of this pattern (tracked separately
    on the onion-architecture skill's `db-confined-to-repositories` drift
    list).
