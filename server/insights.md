# Insights — `server`

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
- 2026-08-09 — NEVER expect a route's `config: { rateLimit: … }` to fire in a
  `.it.test.ts`. `app.ts:95` skips registering `@fastify/rate-limit` entirely
  when `config.nodeEnv === 'test'`, so per-route limits are inert under
  `app.inject()` — a test asserting a 429 after N calls will never see one, and
  a test that *relies* on the limit as a safety fence is testing nothing. Cost
  fences that must hold in tests have to live in the service (e.g. the per-PR
  in-flight dedupe in `IntentService.recalculate`), not in the route config.

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

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

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

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

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

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
  failure in [../insights.md](../insights.md), different symptom entirely.

## Session Notes

Dated one-line records of sessions that changed something material.

_None yet._

## Open Questions

Unresolved, worth investigating.

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
