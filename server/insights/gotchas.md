# Gotchas — `server`

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

- 2026-08-21 — NEVER key a service-level `static readonly inFlight = new
  Map<string, Promise<T>>()` dedupe cache by an id ALONE (e.g. `pr_id`) when
  the entry point is workspace-scoped — `BriefService.generate`
  (`modules/reviews/brief/service.ts`) originally did the ownership check
  (`getPull`/`getRepo`, workspace-scoped) INSIDE `doGenerate`, but the
  `inFlight.get(prId)` short-circuit sat in front of that, in `generate`
  itself. Because the map carries no workspace, a caller in workspace B
  hitting `generate(workspaceB, prId)` while workspace A's generation for the
  same `prId` was still running joined A's in-flight promise and got back
  A's full result — no ownership check ever ran for B. `IntentService
  .recalculate`'s identical `inFlight` shape (`intent/service.ts`) was
  already correctly ordered (ownership resolved by the caller before entering
  `recalculate`), so this class of bug is a per-instance ordering hazard, not
  a shape problem with the pattern itself. Fix: resolve+check ownership
  BEFORE the map lookup, in the SAME public method that owns the map lookup
  — never leave it inside the private "do the work" method the map wraps.
  Whenever adding a new `static inFlight`-style dedupe keyed by a bare id,
  audit that the very first lines of the public entry point are the
  workspace/tenant check, not the map read.
  └ The only test that catches an ordering regression like this is a REAL
    concurrency test: start caller A, wait for its call to genuinely reach
    the model call (a `SlowLLM extends MockLLMProvider` with a real
    `setTimeout` delay inside `completeStructured`, not `vi.useFakeTimers()`
    — same technique `reviews.it.test.ts`'s own `inFlight`-dedupe test
    already uses), THEN fire caller B and assert it rejects while A's promise
    is still pending. A sequential test (call A, await it, then call B) never
    exercises the map at all and passes identically whether the ownership
    check is above or below the lookup — see
    `server/test/brief-service.it.test.ts`.

- 2026-08-07 — NEVER write a literal glob pattern containing `*/` (e.g.
  `` `*/docs/**` ``) inside a `/** … */` JSDoc block comment — the `*/`
  sequence closes the comment early, and `tsc` then tries to parse the rest of
  the glob text as code, producing a cascade of confusing errors (`TS1434`,
  `TS1443`, `TS1109`, `TS1161` "Unterminated regular expression literal") many
  lines below the real cause, none of which mention "comment". Hit writing the
  doc-ref allowlist comment in `modules/reviews/intent/evidence.ts`
  (`docs/**`, `specs/**`, `*/docs/**`, `*/specs/**`, …) as a block comment.
  Fix: use `//` line comments for prose that must contain a literal `*/`, or
  rephrase to avoid the sequence entirely. Same class of footgun as the
  unescaped-backtick-in-template-literal entry below (2026-08-04), different
  trigger character.
- 2026-08-20 — Adding a required call (`this.repo.getDocument(...)`) to
  `ProjectContextService` broke a test OUTSIDE `project-context-service.test.ts`:
  `test/skills-service.test.ts` overrides `(projectContext as unknown as {repo}).
  repo` with an inline object literal (`{ listAttachments, replaceAttachments }`)
  rather than casting a class instance — `TypeError: this.repo.getDocument is
  not a function` at runtime, not a typecheck error, because the override is
  `as unknown as ProjectContextRepository`, which suppresses the missing-method
  check entirely. `ProjectContextRepository` has at least two such ad-hoc
  partial-object overrides across the test suite (`test/project-context-
  service.test.ts`'s full `FakeProjectContextRepository` class is NOT the only
  one) — when adding a call the service makes on `this.repo`, grep
  `unknown as ProjectContextRepository`/`unknown as \{ repo:` across `test/`
  for every file that overrides it, not just the one this task's Acceptance
  names.
  └ 2026-08-20 recurrence, one layer up: adding a required call
    (`this.container.projectContext.skillContext(id)`) to `SkillsService.update`
    (Finding 3's rollback snapshot, pre-PR gate) broke `test/skills-routes.test.ts`
    the same way — a `{ setSkillContext } as unknown as ProjectContextService`
    override with no `skillContext` field. Same rule, one type up the chain:
    before adding a call the SERVICE makes on `container.projectContext`, grep
    `unknown as ProjectContextService` across `test/` too, not just
    `unknown as ProjectContextRepository`.
- 2026-08-20 — Fixing the "`routes.ts` constructs its own service instead of
  using `container.<x>`" DI smell (swapping `new OnboardingService(container);
  service.registerJobHandlers();` for `container.onboarding
  .registerJobHandlers();` in `modules/onboarding/routes.ts`) breaks EVERY
  test in `test/onboarding-routes.test.ts` at `buildApp()` time, not just the
  ones exercising the job path — `registerJobHandlers()` now runs
  synchronously during plugin *registration* (boot), against whatever
  `ContainerOverrides.onboarding` double the test supplied, and every one of
  those doubles was a bare `{ getTour }` / `{ requestGeneration }` object
  cast `as unknown as OnboardingService` with no `registerJobHandlers`
  method — `TypeError: registerJobHandlers is not a function` on the very
  first `buildApp()` call. Same root cause as the entry directly above
  (an `as unknown as X` cast suppresses the missing-method check), but a
  distinct trigger worth naming on its own: this class of fix touches EVERY
  call site that overrides the service via `ContainerOverrides`, not just the
  test the acceptance criteria names, because the newly-added call fires at
  boot for literally every test that builds the app with that override. Fix:
  add a `registerJobHandlers: vi.fn()` (or equivalent) to every override
  object in the file, then grep `ContainerOverrides.<name>` across `test/`
  for any other file doing the same partial-object override before calling
  the task done. Generalizes to any module whose `routes.ts` registers a job
  handler via `container.<x>` at plugin load (`repo-intel/routes.ts` has the
  identical shape and would hit this the moment it's fixed the same way).
- 2026-08-20 — `repo-intel/routes.ts`'s "return 202 even when `enqueue`
  fails" resync precedent (`repo-intel/routes.ts:43-65`) does NOT transplant
  to a route whose 202 body has a strict zod `response` schema. Resync's
  `POST /repos/:id/resync` gets away with degrading to an untyped
  `{status:'accepted', degraded:true, reason:'no_handler'}` because that
  route declares no `response` schema at all AND calls `jobs.enqueue`
  directly in the route handler, where the try/catch can live. Onboarding's
  `POST /repos/:id/onboarding/generate` (`modules/onboarding/routes.ts`, T12)
  has neither: `OnboardingGenerateResponse` is a strict
  `{state: z.literal('generating'), job: {id: z.string()}}` literal with no
  degraded variant, and its `jobs.enqueue` call lives inside
  `OnboardingService.requestGeneration` (T10, a separate task's owned file),
  not the route. There is no honest `job.id` to fabricate on an enqueue
  failure without either violating the contract or lying to the client, so
  the route lets that (in practice near-unreachable, since the handler is
  always registered at module load first) failure surface as a genuine
  error instead. General lesson: before copying a "return success anyway"
  precedent from one route to another, check whether the target route's
  response is contract-typed (no degraded shape available) and whether the
  fallible call is even reachable from the route file at all.
- 2026-08-20 — When a `z.discriminatedUnion('kind', [...])` arm shares a field
  (e.g. `links`) across every arm and a spec's acceptance test parses a
  *minimal* fixture that omits that shared field, the shared field must be
  `.nullish()` — not required — even though the test is really targeting a
  different field (e.g. proving `diagram` isn't representable on a non-diagram
  kind). Making the shared field required makes that same minimal fixture fail
  with a misleading `links: Required` error that has nothing to do with what
  the test is checking, and the failure only shows up when you actually run
  the acceptance one-liner, not from reading the schema. Hit building
  `OnboardingSection` (`server/src/vendor/shared/contracts/knowledge.ts`) for
  the onboarding-tour plan's AC-13 check
  (`OnboardingSection.parse({kind:'first_tasks', title:'T', items:[]})` must
  parse) — `links: z.array(OnboardingLink)` on every arm broke it until
  changed to `.nullish()`. General rule: when an acceptance criterion supplies
  an exact literal fixture, treat every field the fixture omits as needing
  `.nullish()`/`.optional()`, not just the field the AC text names.
- 2026-08-08 — NEVER give a field a Zod `.default([])` in a contract that is
  passed as `schema:` to `llm.completeStructured`. `toJsonSchema`
  (`platform/structured.ts` → reviewer-core `llm/structured.ts`, which wraps
  OpenAI's `zodResponseFormat`) emits a literal `"default": []` keyword into the
  generated JSON schema — verified by dumping the schema for `Intent` — and
  `default` is **not** among the keywords OpenAI's strict structured-output mode
  accepts. The field still lands in `required`, so the default buys nothing at
  the provider and risks a 400. Model-facing contract fields must be plain and
  required; put the leniency in the prompt instead ("return `[]`" as an
  explicitly stated, common answer), exactly as `Intent.out_of_scope` already
  does. Hit adding `Intent.risk_areas` in `vendor/shared/contracts/brief.ts`.
- 2026-08-20 — NEVER build a route's write-body Zod schema directly from a
  mirrored `@devdigest/shared` contract when the same route file defines
  *stricter* refinements for its read-side query/body schemas — the mirrored
  contract stays intentionally unconstrained (e.g. `ProjectContextRef`:
  `{repo_id: z.string(), path: z.string()}`, no `.uuid()`, no path-traversal
  guard) because it also describes persisted/API shapes elsewhere, so a
  handler that does `z.object({ documents: z.array(ProjectContextRef) })`
  silently skips the file's own `ContextPath` refine chain (no leading `/`,
  no `..`) and lets a non-UUID `repo_id` reach a repository call as a raw
  string, surfacing as a Postgres `22P02` 500 instead of a 422. Fixed in
  `modules/project-context/routes.ts`'s `PUT /agents/:id/context` by
  rebuilding the body schema from the file's own `ContextPath` plus
  `z.string().uuid()` rather than importing the contract's unrefined shape.
  General rule: when a route file already defines a stricter local schema
  (a `ContextPath`, an id refinement) for some routes, grep every OTHER
  route in that same file for a raw mirrored-contract import used directly
  as `body`/`querystring` — that is the write path most likely to have
  skipped it, since write bodies are exactly where a hostile shape gets
  persisted. `modules/skills/routes.ts`'s `PUT /skills/:id` (`context:
  z.array(ProjectContextRef).optional()`) has the identical gap and was
  left unfixed here — out of this task's owned paths.
  └ 2026-08-20 fixed: `ContextPath`/`ContextRefBody` extracted to
    `modules/_shared/context-ref.ts` (mirroring the `_shared/net-guards.ts`
    precedent this same file already documents for `isDisallowedIp`/
    `looksLikeHtml`) and imported by BOTH `project-context/routes.ts` and
    `skills/routes.ts`, rather than duplicating the shape a second time —
    extraction was chosen over duplication specifically because a THIRD
    write route accepting the same ref shape is now a real possibility
    (two write paths already exist), and a shared definition means a future
    refinement (e.g. tightening `ContextPath` further) can't drift between
    copies the way this pair already had.
- 2026-08-09 — NEVER expect a route's `config: { rateLimit: … }` to fire in a
  `.it.test.ts`. `app.ts:95` skips registering `@fastify/rate-limit` entirely
  when `config.nodeEnv === 'test'`, so per-route limits are inert under
  `app.inject()` — a test asserting a 429 after N calls will never see one, and
  a test that *relies* on the limit as a safety fence is testing nothing. Cost
  fences that must hold in tests have to live in the service (e.g. the per-PR
  in-flight dedupe in `IntentService.recalculate`), not in the route config.

- 2026-08-20 — A `timeoutMs` passed to `LLMProvider.completeStructured`
  (`adapters/llm/openai.ts:104-118`) bounds ONE provider attempt, not the
  call's total wall time — `withTimeout(...)` wraps each iteration of the
  `for (attempt = 1; attempt <= maxRetries + 1; ...)` loop separately, so a
  caller with `maxRetries: 1` can legitimately take up to `2 × timeoutMs`
  wall-clock. Any job handler that both (a) runs inside `JobRunner`
  (`platform/jobs.ts`, default per-instance `timeoutMs: 120_000` wrapping the
  WHOLE handler via `withTimeout`) and (b) calls `completeStructured` inside
  that handler must size its own `timeoutMs` so `(maxRetries + 1) ×
  timeoutMs` stays comfortably under `JobRunner`'s job timeout — sizing it as
  if `timeoutMs` were the total budget (as `ONBOARDING_GENERATION_TIMEOUT_MS`
  originally did, defaulting to 90000 against a 120s job timeout with
  `maxRetries: 1`, i.e. up to ~180s wall time) lets `JobRunner` abort+retry a
  generation that is still running and may still complete and write its
  result, doubling cost and risking a race between the aborted and retried
  attempt. Fixed for onboarding by halving the default
  (`ONBOARDING_GENERATION_TIMEOUT_MS` 90000 → 45000, `platform/config.ts`);
  any future feature composing these two primitives needs the same `(N+1) ×
  timeoutMs < jobTimeoutMs` sizing, not `timeoutMs < jobTimeoutMs`.

- 2026-08-27 — `ci_runs` (`db/schema/ci.ts`) carries NO `workspace_id` of its
  own — the only route to a workspace is `ci_runs.ci_installation_id ->
  ci_installations.agent_id -> agents.workspace_id`, and
  `ci_installation_id` is `ON DELETE SET NULL` (deliberately, so a run whose
  installation was deleted stays listed rather than vanishing — see the
  `ci_runs_installation_ran_at_idx` gotcha in T9's task brief). The
  consequence: once an installation is deleted, its runs' `ci_runs` rows
  have **no** surviving attribution to any workspace at all. `CiRepository
  .listRuns` (T9, `modules/ci/repository.ts`) scopes with `WHERE
  agents.workspace_id = :workspaceId OR ci_installation_id IS NULL` to
  satisfy "stays listed" — but that `OR … IS NULL` half means an orphaned
  run becomes visible from **every** workspace's `/ci-runs` list, not just
  the one that installed it. This is a genuine multi-tenant leak in a
  real multi-workspace deployment; fixing it needs a `workspace_id` column
  added directly to `ci_runs` (captured at `upsertRun` time, independent of
  the FK), which is a schema change outside T9's owned paths. Flag before
  building anything that assumes `/ci-runs` is workspace-isolated.

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-08-27 — NEVER call `fflate.unzipSync(bytes)` with no `opts.filter` on an
  attacker-adjacent zip and check the size of the RESULT — `unzipSync` fully
  inflates every entry into memory before your code ever sees the returned
  `Unzipped` map, so a `entries[name].byteLength > CAP` check after the call
  (`adapters/github/octokit.ts::downloadRunArtifactFile`, pre-PR-gate finding)
  is not a zip-bomb guard at all; a small crafted zip with one entry whose
  declared size is huge can still OOM the process during the call itself. The
  actual guard is `unzipSync(bytes, { filter: (f) => f.name === wanted &&
  f.originalSize <= CAP })` — `filter` runs against each entry's *declared*
  `originalSize`/`name` from the zip's central directory BEFORE `fflate`
  inflates it, so a rejected entry is never decompressed. That still leaves
  the COMPRESSED payload itself uncapped (a filter can't stop you handing a
  20 MiB blob to `unzipSync` in the first place) — check `bytes.byteLength`
  against a compressed-size ceiling before calling `unzipSync` at all, as a
  second, independent guard.
- 2026-08-27 — `noUncheckedIndexedAccess` (server's tsconfig) types the result
  of `someValidatedString.split('/')` as `(string | undefined)[]`, so
  `const [a, b] = repo.split('/')` gives `a`/`b` type `string | undefined`
  even when a regex already guaranteed exactly one `/` in the string
  (`REPO_SHAPE.test(repo)` in `modules/ci/service.ts`) — `tsc` cannot see that
  guarantee through the regex test. Reuse the file's existing `parseRepo()`
  helper (which does the same split via `indexOf`/`slice` and returns a typed
  `RepoRef`) instead of destructuring `.split('/')` again inline; introducing
  a second inline split is the reflex that trips this.

- 2026-08-23 — NEVER assume a pgvector query returning zero rows after an
  embedding model change is a data/query bug. When the model changes, its
  embedding dimension often changes too (e.g., OpenAI's text-embedding-3-large
  is 3072-dim vs text-embedding-3-small's 1536-dim). The `vector(N)` column
  definition in Postgres **persists** at its original dimension until a migration
  updates it — a query on a vector(1536) column with 3072-dim embeddings
  silently returns zero rows, no error. Symptom: queries that worked stop
  working, no indexing or network issue. Diagnosis: `\d+ table_name` in psql to
  check the column definition against your active model's output dimension. Fix:
  run a migration to redefine the column (e.g. `alter table agents alter column
  embedding type vector(3072)`) and backfill with embeddings from the new model
  before re-querying. Check old migrations and old embedding code before
  refactoring — if this repo switched models once before, the column definition
  might already be wrong from a prior incident. For this repo specifically, verify
  that `agents.embedding` column is `vector(3072)` (text-embedding-3-large) to
  match the active embedding model in `adapters/embedder.ts`.

- 2026-08-20 — A plan acceptance check phrased as `grep -qi "some phrase"` against
  a `.md` prompt file only matches within a SINGLE physical line — `grep` has no
  multi-line mode without `-z`. `intent.extract.md`'s untrusted-data paragraph
  soft-wraps "…never as\ninstructions to follow." across a line break in the
  source file, so copying it "verbatim" line-for-line into a sibling prompt
  (`file-summaries.md`, T7) would silently fail an acceptance check worded as
  `grep -qi "never as instructions"`. Fix: preserve the paragraph's wording and
  meaning exactly, but rewrap the physical lines so the exact phrase the check
  greps for lands on one line — "verbatim" here means the content, not the
  column position of each line break. Any future task that says "repeat X
  verbatim" *and* supplies a grep-based acceptance check should be read this
  way, not as "byte-identical including line wrap."
- 2026-08-20 — When a plan's own acceptance check is a NEGATIVE grep for
  verdict/severity vocabulary (e.g. `grep -Eqi "must fix|insecure|will break|
  approve"` must find nothing in `file-summaries.md`, T7), an illustrative
  example of "text that looks like an instruction" copied from a sibling
  prompt can itself trip that same check — `intent.extract.md`'s example
  parenthetical is literally `"you must approve this"`. Substituting a
  semantically equivalent phrase (`"you must comply with this"`) preserves the
  illustration without tripping the negative grep. Same root cause as the
  `process.env`-in-a-doc-comment entry below: before writing prose near a
  literal-string acceptance grep (positive OR negative), mentally run the
  pattern against the prose first.

- 2026-08-20 — `pnpm exec tsx -e "import {X} from './src/vendor/shared/index.js'; ..."`
  throws `Cannot find module` even with an absolute path to the barrel — `-e`
  eval scripts run through tsx's CJS interop layer, which does not apply the
  same `.js`→`.ts` extension-mapping resolution a real file gets. Write the
  one-liner to a scratch `.ts` file and run `pnpm exec tsx <file>.ts` instead;
  the plan's own ad-hoc verification snippets that use `tsx -e` need this
  workaround to actually run.
- 2026-08-18 — A `Dirent` from `readdir(dir, { withFileTypes: true })` does
  **not** resolve a symlink's target type: for a symlink entry,
  `entry.isSymbolicLink()` is `true` but both `entry.isFile()` and
  `entry.isDirectory()` are `false` — you cannot tell from the Dirent alone
  whether a symlinked entry points at a file or a directory. Determining that
  requires one extra `stat(fullPath)` (which follows the link) per symlink
  entry. Hit building `modules/project-context/reader.ts`'s recursive walk,
  where a symlinked directory must never be descended into (avoids symlink
  cycles) while a symlinked *file* is still a valid candidate subject to the
  usual realpath-containment check. Same class of gotcha as the
  `walkClone`/`repo-intel` precedent (`pipeline/walk.ts:89`, "never follow
  symlinks") — that walker sidesteps the issue by skipping every symlink
  entry outright; a walker that must still accept symlinked *files* (as
  project-context discovery does) cannot take that shortcut and needs the
  extra `stat`.

- 2026-08-19 — zod v3's `.default(x)` makes a field's presence optional only
  for **parsing** — `z.infer<>` (the OUTPUT type) still marks that field
  REQUIRED, not `field?:`, because a default guarantees it's always present
  after `.parse()`. This means adding `.default([])` to a widely-shared,
  already-in-use contract (e.g. `ProjectContextDocument.drifted_for`,
  `server/src/vendor/shared/contracts/project-context.ts`) is NOT a
  no-ripple change for code that constructs plain TS object literals of that
  type directly (not through `.parse()`) — every such literal, anywhere in
  the codebase, now needs the field or `tsc` fails with `TS2741: Property
  '…' is missing`. Confirmed concretely: adding `drifted_for` broke
  `pnpm typecheck` in THREE client test files
  (`ContextTab.test.tsx` ×2, `ProjectContextView.test.tsx`) that hand-build
  `ProjectContextDocument` fixtures, while every real API response stayed
  correct (the server's own object-literal call sites — `service.ts`'s
  `scanAndBuildResponse`/`preview` — were updated in the same change; the
  broken sites were pre-existing literals the contract-adding task didn't
  own). `.default([])` is still the right call per the AC-33-style
  backward-compat rule ("older cached/persisted shapes still parse") — the
  lesson is to expect and flag test-fixture ripple in every OTHER
  module/package that builds literals of the extended type, not to read a
  clean `tsc` in your own module as proof the change is ripple-free
  repo-wide.

- 2026-08-18 — drizzle-orm 0.38.3's `PgInsertOnConflictDoUpdateConfig` field for
  a conditional `ON CONFLICT DO UPDATE` is `setWhere` (or the deprecated
  `where`) — NOT a `.where()` chained after `.onConflictDoUpdate()`, which
  doesn't exist on the insert builder. To reference the row that *would* have
  been inserted (Postgres's `EXCLUDED` pseudo-table) from `set`/`setWhere`,
  use a raw `sql\`excluded.column_name\`` fragment (snake_case DB column
  name, not the camelCase TS field) — there is no typed helper for it. Used in
  `modules/project-context/repository.ts::upsertDocuments` to make the update
  a no-op when `content_hash` didn't change. Also: this drizzle-orm version's
  `pg-core` has no `union`/`unionAll` query-builder combinator exported
  anywhere findable in its `.d.ts` files — a genuine `UNION` (e.g. "distinct
  agent ids from two different attachment paths", `usedByAgentCounts`) has to
  be a raw `sql` template through `db.execute()`, same pattern already used in
  `modules/repo-intel/repository.ts:414`.

- 2026-08-18 — There are ZERO colocated test files anywhere under
  `src/modules/**` in this repo (`find src/modules -iname '*.test.ts'` is
  empty) — every `*.it.test.ts` lives under `server/test/`, even for a
  single-file module like a repository. A task brief that says "plus its
  colocated test file" for a `repository.ts` should be read as "the test file
  for this repository", placed at `server/test/<module>-repository.it.test.ts`,
  not literally next to the source file — there is no precedent for the
  latter and nothing in the vitest config special-cases `src/**/*.it.test.ts`.

- 2026-08-07 — `npm run depcruise` (referenced by the `onion-architecture` skill
  as an already-working gate, "0 errors, 15 warnings") does **not exist yet** in
  this repo: `dependency-cruiser` is a listed devDependency but there is no
  `depcruise` script in `package.json` and no `.dependency-cruiser.cjs` (or
  similar) config anywhere outside `node_modules`. `npx depcruise --version`
  also fails outright on the default Node 18 (`SyntaxError: ... does not
  provide an export named 'styleText'` from `node:util`) — it needs Node 22
  (`nvm use` first) just to report its version, let alone run a graph check.
  Until someone adds the script + config, treat "run depcruise" as a no-op and
  say so explicitly in task reports rather than assuming a failure is yours.

- 2026-08-07 — `drizzle-orm/postgres-js/migrator`'s skip/apply decision is
  **purely by timestamp, not by file hash or tag name**
  (`node_modules/drizzle-orm/pg-core/dialect.js`, `migrate()`): it reads only
  the single most recent `created_at` row from `drizzle.__drizzle_migrations`
  and applies every journal entry whose `when` is greater. So regenerating an
  already-applied migration (e.g. adding a `check()` drizzle-kit previously
  omitted) with `pnpm db:generate` after deleting the old `NNNN_*.sql` +
  `meta/NNNN_snapshot.json` + journal entry produces a **new** `when`
  timestamp (current time) — always greater than what's in the DB — so
  `pnpm db:migrate` will try to re-run it and fail with "column already
  exists". Fix: after regenerating, manually edit the new entry's `when` in
  `meta/_journal.json` back to the original value (the one that's still in
  `drizzle.__drizzle_migrations.created_at` for that slot) — the tag/file name
  is free to change, only `when` gates re-application. Verify with `select
  created_at from drizzle.__drizzle_migrations order by created_at desc limit
  1` before and after `pnpm db:migrate` to confirm no new row was inserted.

- 2026-08-17 — ALWAYS pass `--exclude '**/*.it.test.ts'` to `vitest related` in
  `server/`. `pnpm exec vitest related --run <src files>` resolves *every* test
  importing those files, `.it.test.ts` included, so it silently starts a
  testcontainers Postgres: measured on `src/platform/price-book.ts`, 16 files /
  17.7s with Docker vs 2 files / 1.4s once the exclude is added. `related` is the
  right tool for a narrow "did I break anything I touch" check (it is what the
  implementer agents run), but only with the exclude — the `--exclude` flag in
  `server/CLAUDE.md`'s unit-test command is not inherited by the `related`
  subcommand.

- 2026-08-21 — NEVER use `z.coerce.boolean()` for a boolean query-string flag:
  `z.coerce` is `Boolean(value)`, so the literal string `"false"` coerces to
  `true` and `?force=false` would force. Declare the flag as
  `z.enum(['true', 'false']).optional()` and compare `=== 'true'` in the handler
  (`modules/reviews/routes.ts::BriefGenerateQuery`).

- 2026-08-21 — `MockLLMProvider` (`adapters/mocks.ts:84,100`) reports a FIXED
  `tokensIn: 100 / tokensOut: 50 / costUsd: 0.001` on every call. NEVER seed a
  DB row with 100/50 tokens in a test that asserts those numbers were "not
  folded in" — `expect(x).toBeLessThan(100)` passes/fails by coincidence.
  Seed a distinctive figure (e.g. 777) and assert the exact mock totals.

- 2026-08-21 — `classifyPath` (`smart-diff/constants.ts::CLASSIFY_RULES`) puts
  `app|server|main|bootstrap|entry.ts`, any `index.ts`, and `config|settings.ts`
  in `wiring`, and `*.test.ts` in `boilerplate`. A test fixture that needs a
  `core` path must avoid those basenames — `src/app.ts` is NOT core; use
  something like `src/payments/charge.ts`.

- 2026-08-21 — `Finding.severity` is `CRITICAL | WARNING | SUGGESTION`
  (`vendor/shared/contracts/findings.ts::Severity`), NOT
  `critical/high/medium/low/info`. A `Record<string, number>` rank table keyed
  by the lowercase tiers typechecks fine and silently ranks everything equal
  (`?? 9`). ALWAYS type such tables `Record<Finding['severity'], number>` so a
  wrong key is a compile error (`brief/evidence.ts::SEVERITY_RANK`).

- 2026-08-27 — A Fastify route body meant to be OPTIONAL (e.g. `POST
  /ci-runs/refresh`'s `{ agent_id? }`, T13 `modules/ci/routes.ts`) must wrap
  the WHOLE Zod object in `.optional()` (`z.object({...}).optional()`), not
  just its one field — `apiFetch` (client) only sets a JSON content-type
  header when a body is actually sent, so a body-less POST arrives with
  `req.body === undefined` and no content-type at all. A schema that's an
  object with only its inner field optional still requires an object at the
  top level, and validating `undefined` against it fails with Fastify's own
  "Body cannot be empty" error before the handler ever runs. `CiIngestService
  .refresh`/`.list` (T11, `modules/ci/ingest.ts`) also construct their own
  `CiRepository` from `container.db` unconditionally (no injectable/override
  seam, per the 2026-08-27 `CiRepositoryLike` entry above) — so `GET
  /ci-runs`/`POST /ci-runs/refresh` cannot be exercised by a hermetic,
  no-DB `app.inject()` route test; only `POST /agents/:id/export-ci`'s
  target-validation 4xx (thrown synchronously by `CiService` before any DB
  call) could be proven that way for T13's acceptance test
  (`modules/ci/routes.test.ts`). A future test of the `/ci-runs*` routes
  needs the `.it.test.ts` suffix (testcontainers Postgres), not a plain
  `MockAuthProvider`-only override.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

- 2026-08-25 — `Anthropic structured output failed schema validation` on eval
  runs (whole batch aborts): without `strict: true` on the forced tool,
  claude-haiku omits required scalar fields (`verdict: Required` from Zod) even
  though the `input_schema` marks them required — Anthropic tool `input_schema`
  is guidance, not enforcement, unlike OpenRouter/OpenAI strict `json_schema`
  mode which the same `toJsonSchema` output IS enforced under. Fix: set
  `strict: true` on the tool (`adapters/llm/anthropic.ts`) — but strict mode
  rejects numeric bounds (`400 ... For 'integer' type, properties maximum,
  minimum are not supported`), so strip `minimum`/`maximum`/`exclusive*` from
  numeric properties in the schema copy sent to Anthropic (Zod still enforces
  the bounds after parsing). NOTE `@anthropic-ai/sdk` 0.33 types don't know
  `strict` — cast the tool literal to `Anthropic.Tool`.

- 2026-08-25 — `400 invalid_request_error: "tool_use ids were found without
  tool_result blocks immediately after"` on every anthropic-provider agent run
  that needed a schema-validation retry. Cause: `AnthropicProvider.
  completeStructured`'s reprompt loop pushed the assistant turn (containing the
  forced `tool_use` block) followed by a PLAIN-TEXT user message — the Anthropic
  Messages API requires the next user message to answer with a `tool_result`
  block carrying the matching `tool_use_id`, so attempt ≥2 was rejected before
  reaching the model (OpenRouter/OpenAI chat format has no such rule, which is
  why the same loop worked there). Fix: send the reprompt as
  `{type:'tool_result', tool_use_id, is_error:true, content}` and fall back to
  plain text only when the response had no `tool_use` block
  (`adapters/llm/anthropic.ts`, test `test/anthropic-adapter.test.ts`).

- 2026-08-19 — A raw NUL byte (0x00) inside a `.ts` template literal (e.g.
  `` return `${repoId}\0${docPath}`; `` written with a literal control
  character rather than the `\x00` escape) makes `git` classify the WHOLE
  FILE as binary: `git diff --stat` reports `Bin 0 -> N bytes, 0
  insertions(+), 0 deletions(-)` no matter how many real lines changed, and
  `grep` (without `-a`), `git blame -L`, and normal patch application all
  silently fail or return nothing on that file. Found in
  `modules/reviews/prompt-context.ts` (a 349-line file, the one deciding what
  an LLM actually reads) via `file <path>` reporting `data` instead of a text
  type, and `python3 -c "open(path,'rb').read().find(b'\x00')"` to locate the
  byte offset — `grep -an` also works once you remember to add `-a`. Fix:
  replace the literal NUL with the `\x00` escape sequence in the source
  (behaviorally identical string at runtime, but now ASCII in the file) —
  verify with `file <path>` reporting a text type again and `git diff --stat`
  showing real insertion/deletion counts. Same class of footgun as this
  file's `*/`-inside-a-JSDoc-glob and unescaped-backtick entries above
  (2026-08-07, 2026-08-04) — a literal special character silently corrupting
  how tooling parses/diffs a `.ts` file — but a NUL byte is worse: it hides
  the entire file from code review, not just from `tsc`.
  └ 2026-08-19 second sighting: `test/project-context-service.test.ts:52`
    (`docKey`) carried the same literal NUL, independently of
    `prompt-context.ts` — so this is a recurring authoring slip, not a
    one-off. It hid the whole 16 KB test file from `grep` (silent exit 1, no
    "binary file matches" warning). NEVER try to find these with `grep` for a
    NUL: the shell cannot pass a 0x00 byte in argv, so `grep $'\x00' …`
    degenerates to an EMPTY pattern and reports every file as a hit. Use
    `file` (a NUL-carrying `.ts` reports `data`, not `… text`) or
    `python3 -c "import sys;[print(p) for p in sys.argv[1:] if b'\0' in open(p,'rb').read()]" $(git ls-files '*.ts')`.

- 2026-08-07 — A doc-comment sentence like "never read `process.env`
  directly" **fails** a verification gate phrased as
  `` grep -rn "process.env" some/dir/ `` — must return nothing — even though
  it isn't a real usage. `grep` without `-F`/`-E` still treats `.` as
  "any character" (BRE), so `process.env` as a pattern also matches
  `process environment` (space fills the wildcard) or any `processXenv`-shaped
  text. Hit writing the credential-source doc comments on
  `adapters/tickets/{jira,linear}.ts` (T16) — the honest "NEVER read
  `process.env`" sentence in the JSDoc tripped the task's own
  `grep -rn "process.env"` acceptance check. Fix: phrase such comments without
  the exact wildcard-matchable shape (e.g. "the OS-level environment" instead
  of "`process.env`"), or verify with `grep -F` if a literal match is truly
  intended. Generalize: before writing a doc comment near code a
  literal-string acceptance grep will scan, mentally run the grep pattern
  against the comment text too — BRE metacharacters (`.`, `*`, `[`) make
  "mentions the term" and "matches the pattern" different questions.

- 2026-08-07 — `error TS2729: Property 'container' is used before its
  initialization` on a class field initializer that reads a constructor
  **parameter property**, e.g. `private repo = this.container.reviewRepo;`
  next to `constructor(private container: Container) {}`. Class field
  initializers run in declaration order as if they were the first statements
  of the constructor, but a `private x: T` **parameter property** is assigned
  from the parameter even later than that — so a field initializer above it
  in the class body sees `this.container` as still `undefined`. Fix: declare
  the field's type only (`private repo: Container['reviewRepo'];`) and assign
  it in the constructor **body**, after the parameter property line executes.
  Hit writing `IntentService` (`modules/reviews/intent/service.ts`), which
  copies the `constructor(private container: Container) { this.repo = new
  XRepository(container.db); }` shape seen in `conventions/service.ts` and
  `reviews/service.ts` — that shape works specifically because it assigns in
  the constructor body, not as a field initializer; matching it exactly avoids
  this trap.

- 2026-08-06 — `TypeError: Cannot read properties of undefined (reading 'skills')`
  from `run-executor-skills.it.test.ts:142` is a **CI-only flake, and the error
  names the wrong thing**. `waitForPrRuns` (`test/helpers/runs.ts:31`) *returns*
  on timeout instead of throwing — `if (Date.now() - start > timeoutMs) return
  runs;` — so on a loaded runner the run hasn't reached a terminal state, the
  helper hands back anyway, and `GET /runs/:id/trace` answers without a
  `prompt_assembly` key. The undefined property is the symptom; the silent
  10s timeout is the cause. Seen green locally and on the previous CI run of the
  same branch, red once, then green again on a bare `gh run rerun --failed` with
  no code change. **Do not go hunting in your diff for a `prompt_assembly`
  regression** — rerun first, and only investigate if it reproduces. The real fix
  is for the helper to throw on timeout so the failure names itself; left alone
  here because every caller would need re-checking.

- 2026-08-05 — `The "string" argument must be of type string or an instance
  of Buffer or ArrayBuffer. Received an instance of Date` from a Fastify route
  handler (surfaces as a bare 500, no stack trace in the response body — add a
  temporary `console.error(res.body)` around the failing `app.inject` call to
  even see this message) means a raw `sql\`...${jsDate}...\`` template
  (drizzle-orm's `sql` tag, not `gte`/`lt`/`eq`) interpolated a `Date` value
  directly into a hand-written fragment. Column-comparison helpers
  (`gte`/`lt`/`eq`) apply the column's type mapping to a Date correctly; a raw
  `sql` template with a bare `${someDate}` does not, and the failure surfaces
  deep in postgres-js's parameter encoding, nowhere near the query that caused
  it. Fix: use the typed helper (`lt(col, date)`) instead of hand-rolling the
  comparison in `sql\`\`` (`modules/agents/repository.ts`'s `avgCostDelta`).

- 2026-08-04 — `error TS1005: ',' expected` reported dozens of lines past the
  real problem, inside a `seed-prompts.ts`/`community-catalog.ts`-style markdown
  body written as a backtick template literal, means an inline code span in the
  markdown (e.g. `` `Object.keys` ``) used an unescaped backtick and silently
  closed the template literal early. TSC then mis-parses everything after it as
  new statements, so the reported error location is nowhere near the actual
  unescaped backtick. Fix: every literal backtick inside such a body must be
  `` \` ``, not `` ` `` — grep the body for bare `` ` `` pairs when this error
  shows up in one of these files.

- 2026-07-30 — `TypeError: diagnostics.tracingChannel is not a function` at
  `node_modules/fastify/lib/wrap-thenable.js` when running `pnpm test` means the
  shell is on the default Node 18, not the repo's Node 22. Fastify 5 needs
  `diagnostics_channel.tracingChannel` (Node ≥ 19.9). It surfaces as a *suite
  collection* failure ("0 test") with no mention of Node, so it reads like a
  broken import. Fix: `nvm use` first. Same root cause as the Next.js boot
  failure in [../../insights/gotchas.md](../../insights/gotchas.md), different symptom entirely.

---

## Earlier entries

Recorded before the section format existed. Kept verbatim — never migrated,
reworded, or moved.

## 2026-07-28 — server tsc/tests fail on reviewer-core's deps, not server's

**Symptom:** `pnpm install` in `server/` succeeds, but `pnpm typecheck` fails
with `TS2307: Cannot find module '@devdigest/reviewer-core'` (cascading into
`unknown` → `T` errors), or `pnpm test` crashes at module load with
`ERR_MODULE_NOT_FOUND` for `openai`/`zod` — packages `server/package.json`
doesn't even list.

**Cause:** `tsconfig.json` aliases `@devdigest/reviewer-core` →
`../reviewer-core/src/index.ts`, so the server type-checks and runs
reviewer-core's **raw TypeScript source**, not a built package. That source's
own imports (`openai`, `zod`) resolve from `reviewer-core/node_modules` — a
directory `server`'s own `pnpm install` never touches.

**Fix:** `cd ../reviewer-core && pnpm install` (or `pnpm install --frozen-lockfile`
in CI) as a separate step before typechecking or testing `server/`. Every CI
workflow that touches server (`server-unit.yml`, `server-integration.yml`,
`e2e-web.yml`) already does this as an explicit "Install reviewer-core deps"
step — mirror it locally after a clean clone or after deleting
`reviewer-core/node_modules`.
