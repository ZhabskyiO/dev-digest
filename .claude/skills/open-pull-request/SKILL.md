---
name: open-pull-request
description: Opens a pull request for the current branch following this repo's conventions — Conventional Commits PR title, the committed PR template filled in honestly, and a self-review before requesting review. Use when asked to open, create, raise, or submit a PR.
when_to_use: When the user asks to open/create/raise/submit a pull request, or says "PR this", "put this up for review", "ship it for review". Also read it before pushing a branch you intend to turn into a PR.
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh pr edit:*), Bash(gh auth status:*)
---

# Open a Pull Request

## Hard rules

1. **Never open a PR without the user's explicit go-ahead** for *this* PR. A PR is
   visible to others; approval once is not approval always.
2. **Never `--force` push, never `--no-verify`.** If a hook or check blocks you,
   fix the cause or report it — don't bypass.
3. **Never open a PR from `main`.** Branch first, then PR.
4. **Never invent test results.** The "How has this been tested?" section lists
   commands you *actually ran*, with their real outcome. If you didn't run the
   suite, say so.

## Sequence

### 1. Establish the diff

```sh
git status
git log --oneline main..HEAD
git diff main...HEAD --stat
```

Read the actual diff, not just the stat. You cannot describe or self-review a
change you haven't read.

Confirm nothing forbidden is staged: `server/clones/**`, `client/.next/**`,
lockfiles you didn't intend, and above all **no secrets** — API keys belong in
`~/.devdigest/secrets.json`, never in `.env`, the DB, or a fixture.

### 2. Title — Conventional Commits, required

This repo **squash-merges**, so the PR title becomes the permanent commit subject
on `main`. It is the most durable line you will write. Format:

```
<type>(<scope>): <imperative summary>
```

- **type** — `feat` · `fix` · `refactor` · `perf` · `docs` · `test` · `build` ·
  `ci` · `chore`
- **scope** — the package or area: `server` · `client` · `reviewer-core` · `e2e` ·
  `shared` · `db` · `skills`. Omit only when the change is genuinely
  repo-wide.
- **summary** — imperative mood, lowercase, no trailing period, ≤ 72 chars total.
- **breaking change** — append `!` before the colon (`feat(shared)!: …`) *and*
  spell out the migration path in the body.

```
feat(client): show run cost on the PR list and run drawer
fix(server): stop pricing lookup falling back to the wrong namespace
refactor(reviewer-core): extract diff chunking from the review loop
chore(e2e): unify onto pnpm
```

Not this:

```
Update stuff                        # no type, no scope, says nothing
feat: Added cost badges.            # past tense, capitalised, trailing period
feat(client): fix the thing where the cost badge sometimes shows stale data on
                                    # over 72 chars; and it's a fix, not a feat
```

Note the deliberate split: **branch commit subjects stay imperative and
unprefixed** (`Add cost badge`) because the squash discards them. Only the PR
title carries the Conventional Commits prefix, because only the PR title lands.

### 3. Body — use the committed template

The template at [.github/pull_request_template.md](../../../.github/pull_request_template.md)
is the source of truth. Read it and fill it in — do not write a body from scratch
and do not paraphrase the template from memory; it changes.

Rules for filling it:

- **Delete sections and checklist groups that don't apply.** The template says so
  itself. A PR carrying eight irrelevant checklist groups is noise that trains
  reviewers to skim.
- **Tick a box only if it is true.** An unticked box is information; a falsely
  ticked one is a lie that costs a reviewer their afternoon.
- **`Closes #`** — fill in the issue number, or delete the line. Never leave it
  dangling.
- **Motivation and context** is the section reviewers actually need: why this is
  needed, and why this approach over the obvious alternative. A reviewer who
  wasn't in your head should be able to judge the trade-off from that paragraph
  alone.
- **Which CI will run** — the template's path→workflow table tells you. Two traps
  worth restating in the PR body when they apply: a docs/`scripts/`/root-config-only
  PR runs **no checks at all** (a green tick means nothing ran), and
  `reviewer-core/**` does not trigger `e2e-web` even though the API imports its
  source at runtime.
- **Notes for the reviewer** — parts you're unsure about, deliberate trade-offs,
  follow-ups left out on purpose, suggested reading order for a large diff.

Pass the body via a file, never a fragile inline string:

```sh
gh pr create --title "<conventional title>" --body-file <path>
```

Write that file to the scratchpad directory, not into the repo.

### 4. Self-review before requesting review

Non-negotiable, and it is the single highest-leverage step here:

- Re-read your own diff as if it were someone else's.
- Run `pnpm typecheck` and `pnpm test` in **every package you touched** — they're
  standalone packages, so "the root passed" proves nothing about the others.
- Remove debug logging, commented-out code, and stray TODOs you don't intend to keep.
- If you changed the DB schema, the client, the server, shared contracts, or e2e
  flows, work the matching template checklist group honestly — each item in it
  encodes a real failure this repo has already hit.

### 5. Scope and size

- **One logical change per PR.** If the diff needs "and" to describe, it probably
  wants splitting. Say so rather than opening a PR you know is two PRs.
- Keep unrelated formatting churn out. A 40-line change hidden in a 900-line
  reformat will not get a real review.
- If a large diff is genuinely unavoidable, give the reviewer a reading order.

### 6. Draft vs ready

Open as a **draft** (`--draft`) when CI hasn't run yet, the work is incomplete,
or you want early directional feedback. Mark ready only once you'd defend every
ticked box.

### 7. After opening

Report the URL to the user. Then verify what actually ran:

```sh
gh pr view --json url,title,isDraft,statusCheckRollup
```

If the rollup is empty, the change touched only path-filtered-out paths — tell
the user that no checks ran and that the change needs manual verification, rather
than presenting a green PR as validated.

## Repo-specific gotchas that bite at PR time

- **Wrong GitHub account.** This repo pushes as `ZhabskyiO` over the
  `github-secondary` SSH host alias, and its local `user.email` is repo-scoped.
  If a push or `gh` call fails on identity, check `gh auth status` and
  `git config --local user.email` before anything else.
- **Node ≥22.** `nvm use` first, or the client refuses to build and your "tested"
  claim is false.
- **Migrations never run on boot.** If you added one, you must have run
  `cd server && pnpm db:migrate` against a real database.
- **`vendor/shared` is two physical copies.** Editing `server/src/vendor/shared/`
  alone breaks the client build. Sync both, and tick that box only if you did.
- **Test-file naming decides the CI lane.** A DB-backed test must be
  `*.it.test.ts`; a hermetic one must not be. Get it wrong and the test silently
  stops running.

## Wrapping up

After the PR is open, run `/engineering-insights` if the work surfaced anything
non-obvious. Writing nothing is correct when nothing new came up.
