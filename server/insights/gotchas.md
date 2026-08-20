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

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

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

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

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
