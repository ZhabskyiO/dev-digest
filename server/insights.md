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

_None yet._

## Codebase Patterns

Conventions and architectural decisions specific to this repo.

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

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

_None yet._

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

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

_None yet._

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
