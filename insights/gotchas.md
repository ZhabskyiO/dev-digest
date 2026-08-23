# Gotchas — repo-wide

Append-only log of what broke and why: dead ends, dependency and environment
quirks, and error → cause → fix records. Newest at the top.

> **Format:** new entries go under the matching section below as
> `- YYYY-MM-DD — one-line claim`, with `file:line` evidence where it applies.
> Lead hard constraints with **NEVER** / **ALWAYS**.
> **Corrections:** append `└ YYYY-MM-DD correction: …` beneath an entry — never
> rewrite, move, or delete what is already there.
> When an entry starts causing repeated mistakes, promote a one-line version of
> it into [CLAUDE.md](../CLAUDE.md) and leave the full detail here.
> Package-specific entries belong in that package's own `insights/` folder.
> The other half of this log lives in [INSIGHTS.md](INSIGHTS.md).

## What Doesn't Work

Dead ends and antipatterns — what was tried and failed, and why. **This is the
most-skipped and most-valuable section: if something failed, record it here.**

- 2026-08-20 — NEVER defer a task's own test to "a later `test-writer` pass"
  when the run is driven by `/run-plan`. That skill **deliberately does not
  invoke `test-writer`** (its guardrails say so explicitly): coverage comes only
  from each implementer's self-verification. A plan's `## Testing strategy`
  section may still name `test-writer` as the owner of some suite — that naming
  is about a manual run, not about `/run-plan`, and reading it as a promise
  ships the acceptance criterion unproven. Seen when an implementer skipped an
  `.it.test.ts` its own Acceptance list required, on the strength of the plan's
  testing-strategy line; a sibling task in the same phase wrote its equivalent
  test and was right to. If a task's Acceptance names a test, that task writes
  it.
- 2026-08-23 — NEVER pin a workflow `trace`/`dispatch` eval to exactly one of
  `architecture-reviewer` / `architecture-reviewer-lite` for a PR-sized prompt.
  With both agents on disk, Haiku's pick flips between consecutive runs even
  when the prompt names `architecture-reviewer` literally (the lite description
  claims "PR-sized changes ≤ ~10 files"). Use `expectAnySubagent` for the role
  (`evals/src/dsl/case.ts`), and pin a specific agent only where the descriptions
  are unambiguous (multi-module audit → full reviewer). A wrong pick also costs
  ~150 s: early-stop never fires, so the case waits out the nested agent's run.
  └ 2026-08-23 correction: fixed at the source. Both descriptions now state the
    split explicitly (full: ALWAYS when named / multi-module / > ~10 files;
    lite: ONLY unnamed PR-sized single-module, NEVER substitute when named).
    After that, by-name → full, unnamed PR-sized → lite and multi-module → full
    each passed 3/3 on Haiku (`evals/workflow/review-workflow.cases.ts`), so
    those cases pin the agent again; `expectAnySubagent` stays available for
    genuinely interchangeable roles.
  └ 2026-08-23 — same shape for SKILLS: `open-pull-request` and `pr-self-review`
    both claimed "before `gh pr create`", so "відкрий PR" sometimes loaded
    pr-self-review first and ran out of turns. Fix = one entry point: the
    open-pull-request description now says ALWAYS for open/create/submit a PR
    and "do NOT load pr-self-review on its own — this skill runs it" (its step 4
    now invokes `/pr-self-review` explicitly, which the push hook requires
    anyway); pr-self-review's says "if the request is to OPEN a PR, load
    open-pull-request instead". 8/8 across two retry-free runs afterwards.
    Rule: when two artifacts share a trigger phrase, make one the entry point
    and have its description name the other as *not* to be loaded directly.
- 2026-08-23 — NEVER rely on the Agent SDK's `allowedTools` as a restriction
  under `permissionMode: "bypassPermissions"` — it only pre-approves. Asked
  *which command* fixes `relation ... does not exist`, `gemini-2.5-flash` ran
  `pnpm db:migrate` via `Bash` against the live dev DB from an eval session whose
  allow-list was `Read, Grep, Glob, Task, Agent, Skill`. ALWAYS pass a hard
  deny-list as `disallowedTools` too (`evals/src/config.ts:MUTATING_TOOLS`, wired
  in `evals/src/tasks.ts` for both `agentTask` and `workflowTask`). Haiku never
  stepped outside the allow-list, which is why this stayed hidden until the
  OpenRouter/CI validation.

## Tool & Library Notes

Quirks of dependencies, tooling, and the local environment.

- 2026-08-23 — NEVER use `${{ env.* }}` inside `jobs.<job>.env` in GitHub Actions —
  the `env` context is not available there (only github/needs/strategy/matrix/
  vars/secrets/inputs). The workflow file then fails to PARSE: the run shows up
  named by file path with "This run likely failed because of a workflow file
  issue", zero jobs, no annotation. Plain YAML validation cannot catch it.
  Repeat the inputs/vars/default expression per job instead
  (`.github/workflows/harness-evals.yml`).
- 2026-08-23 — deepseek-chat as LLM judge emits invalid JSON escapes inside
  verbatim evidence quotes (`\_`, `\-`, `\.`) → `Bad escaped character in JSON`.
  Repair before parsing: double only a `\` NOT followed by `"\/bfnrtu`
  (`evals/src/scoring/llm-judge.ts:parseJudgeJson`); valid JSON parses unchanged.
- 2026-08-23 — `vitest run <filter>` is a **substring match on the whole path**,
  so `vitest run workflow` also ran `skills/workflow-retro/*.eval.ts` (and its
  model-backed failure looked like a workflow-tier regression). Filter with a
  trailing slash — `vitest run workflow/` (`evals/package.json` `eval:workflow`).

- 2026-07-30 — NEVER read an empty `gh pr view --json statusCheckRollup` as "no
  CI ran". It is also `[]` for the first minute or two after a push, while the
  runs sit **queued** — GitHub only populates the rollup once a run starts. The
  open-pull-request skill says an empty rollup means the change hit only
  path-filtered-out paths; that is one cause of two, and acting on it reports a
  green PR as unverified (or vice versa). To wait correctly, poll `gh run list`
  filtered to the head sha instead:
  `gh run list --branch <b> --json headSha,status,conclusion` and loop until no
  run for that sha has `status != "completed"`. An until-loop over the rollup
  exits instantly on the empty array and tells you nothing.
- 2026-08-14 — Under tsx's in-process loader (`import { register } from
  'tsx/esm/api'`, used by `mcp-server/bin/devdigest.mjs`), the `.js` → `.ts`
  specifier remap applies to STATIC imports only. A **dynamic** `await
  import('../http/client.js')` from a `.ts` module dies with
  `ERR_MODULE_NOT_FOUND … client.js imported from …/cli/index.ts`, even though
  the identical static import resolves. Do not "fix" it by importing
  `'../http/client.ts'` — `tsc` then fails without
  `allowImportingTsExtensions`. Restructure so the import can stay static; if
  the dynamic import existed to control module-load ORDER (e.g. setting an env
  var before a config module snapshots it), make the config read lazily
  (a getter) instead — `mcp-server/src/config.ts:17` does this so `--api-url`
  works with static imports.
- 2026-08-20 — `pr-self-review`'s PASS is keyed to a `diffHash` over the whole
  diff state, so **committing invalidates it**. Moving the same content from the
  working tree into a commit changes the hash; `.pr-self-review.json` is then
  stale and `scripts/check-gate.sh` denies the next `git push` as though no
  review ever ran. ALWAYS re-run
  `.claude/skills/pr-self-review/scripts/diff-hash.sh` and update the state
  file's `diffHash` (and `head`) after any commit that follows the review —
  otherwise the failure surfaces at push time and reads like a tooling bug
  rather than a stale record. Same applies after `--amend` or a rebase.
- 2026-08-22 — NEVER trust the `dev` flag in `pnpm audit --json` findings to
  tell prod from dev exposure: it reports `"dev": false` for advisories reached
  only through a devDependency (e.g. `.>tsx>esbuild` in `server/`, where `tsx`
  is dev-only). Attribute by the first segment of the finding `path` (the
  top-level dep) and look that name up in our own `package.json` — that is what
  `.claude/skills/dependency-checker/scripts/collect-deps.mjs` does. Also:
  `pnpm outdated` / `pnpm audit` exit 1 *when they find something*, with the
  JSON still on stdout — a `set -e` shell or a bare `execFileSync` drops it.
- 2026-08-22 — `tsconfig.json` is JSONC, but NEVER strip its comments with a
  `/\/\*[\s\S]*?\*\//` regex: every wildcard path alias (`"@devdigest/shared/*"`,
  `"@/*"`) contains `/*`, so the regex eats the rest of the file and
  `JSON.parse` fails (or silently yields no `paths`). Use a string-aware
  stripper — `stripJsonc()` in
  `.claude/skills/dependency-checker/scripts/collect-deps.mjs` — or `tsc
  --showConfig`.

## Recurring Errors & Fixes

Error message → cause → fix. Keep the literal error text so it is greppable.

_None yet._

---

## Earlier entries

Recorded before the section format existed. Kept verbatim — never migrated,
reworded, or moved.

## 2026-07-28 — reviewer-core and e2e were on npm, unified to pnpm

**Symptom (historical):** `reviewer-core/` and `e2e/` had `package-lock.json`
while `client/` and `server/` had `pnpm-lock.yaml` — no comment, README, or
commit explained the split (repo started from a single "Initial commit").

**Cause:** best guess from the evidence, not a documented decision. Both
packages are trivial leaves — `e2e` has zero runtime deps, `reviewer-core` has
two (`openai`, `zod`) — so neither needed anything pnpm offers, and nothing
forces consistency since these are four independent packages, not a workspace.
CI had already frozen the split in per-package `npm ci` steps, which is why it
survived unnoticed.

**Fix:** converted both to pnpm (deleted `package-lock.json`, generated
`pnpm-lock.yaml`, added `.npmrc` to `reviewer-core` matching client/server's
`node-linker=hoisted`) and updated every CI workflow
(`reviewer-core.yml`, `server-unit.yml`, `server-integration.yml`,
`e2e-web.yml`) plus `TESTING.md`. All four packages are pnpm now — see
[server/insights/gotchas.md](../server/insights/gotchas.md) for the still-real gotcha this did
**not** remove (installing reviewer-core's deps is still a separate step).

## 2026-07-27 — Port 5432 taken by a *native* Postgres, not a container

**Symptom:** `docker compose up` fails with
`Ports are not available: ... bind: address already in use` on 5432, while
`docker ps` shows no Postgres container and `lsof -iTCP:5432` returns nothing.

**Cause:** an EnterpriseDB PostgreSQL 16 install running as a system launch
daemon (`/Library/PostgreSQL/16/bin/postgres`, loaded from
`/Library/LaunchDaemons/postgresql-16.plist`). Plain `lsof` can't see it because
the socket is owned by another user — it needs `sudo`.

**Fix:** `sudo launchctl unload /Library/LaunchDaemons/postgresql-16.plist`
(also disables auto-start on reboot). Diagnose with
`ps aux | grep postgres` rather than `lsof`, which reports nothing useful here.
The alternative is remapping the host port in `docker-compose.yml`, which then
requires updating `DATABASE_URL` everywhere.

## 2026-07-27 — Next.js won't boot on the default Node

**Symptom:** `pnpm dev` in `client/` exits immediately with
`You are using Node.js 18.16.0. For Next.js, Node.js version
"^18.18.0 || ^19.8.0 || >= 20.0.0" is required.`

**Cause:** the shell's default nvm version is older than the repo's `.nvmrc` (22).

**Fix:** `nvm use` before any client/server command. Worth wiring an automatic
`nvm use` on `cd` into the shell profile — this will otherwise recur constantly.
