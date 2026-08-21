---
name: engineering-insights
description: Captures non-obvious engineering discoveries into the right module's insights/ folder (INSIGHTS.md or gotchas.md). Use when a debugging session lands on a surprising cause, a workaround is introduced, a dead end is ruled out, or a task is wrapping up. Also use when asked to record, capture, or save a learning, insight, gotcha, or lesson.
when_to_use: At the start of work in a module, to load that module's prior insights. At the end of a task or session, to capture what was learned. On phrases like "add to insights", "capture this", "remember this gotcha", "wrap up", "what did we learn".
allowed-tools: Read, Grep, Glob, Edit, Bash(${CLAUDE_SKILL_DIR}/scripts/list-entries.sh:*), Bash(git status:*), Bash(git diff:*)
---

# Engineering Insights

Keeps each module's `insights/` folder fed so knowledge survives `/clear`,
compaction, and the end of a session. Read the relevant module's files **before**
working; append what was genuinely learned **after**.

Every module keeps one `insights/` folder holding two halves of the same log:

| File | Holds |
|---|---|
| `insights/INSIGHTS.md` | What Works · Codebase Patterns · Session Notes · Open Questions |
| `insights/gotchas.md` | What Doesn't Work · Tool & Library Notes · Recurring Errors & Fixes |

Pick the file from the section the entry belongs in — see
[Which section](#which-section).

## Non-destructive rules — these override everything else below

1. **Append-only. NEVER modify, reword, move, or delete an existing entry.**
2. **NEVER use `Write` on an existing insights file** — it replaces the whole
   file. Use `Edit` for targeted insertion, always.
3. **Corrections are appended, not applied.** When new information refines an
   existing entry, add a dated sub-note beneath it and leave the original line
   untouched:
   ```markdown
   - 2026-07-28 — reviewer-core needs its own `pnpm install`.
     └ 2026-08-02 correction: also required before `pnpm test`, not just typecheck.
   ```
4. **Touch nothing unrelated to the current discovery.** Other entries, other
   sections, and other files stay exactly as they are.
5. **Only files under an `insights/` folder.** NEVER write to `README.md`, `CLAUDE.md`,
   `docs/`, `specs/`, or source. Claude Code's built-in auto-memory owns
   `CLAUDE.md`; this skill must not collide with it.
6. **NEVER write anywhere under `server/clones/**`** — vendored checkouts of
   other repos, including a full copy of this one.
7. If the target file is missing, create it from
   [assets/insights-template.md](assets/insights-template.md) or
   [assets/gotchas-template.md](assets/gotchas-template.md), whichever half is
   missing. If it exists, **never** re-template over it.
8. **Never delete to make room.** See [Size](#size--report-never-prune).

## Read first

Before working in a module, read its `insights/` folder (both halves) **and** the
root `insights/` folder. Treat entries as high-confidence guidance unless the code
contradicts them — if it does, that contradiction is itself worth capturing.

## Which file gets the entry

Route by the module the work actually touched.

| Touched path | Target folder |
|---|---|
| `client/**` | `client/insights/` |
| `server/**` (incl. `server/src/modules/repo-intel/**`) | `server/insights/` |
| `reviewer-core/**` | `reviewer-core/insights/` |
| `e2e/**` | `e2e/insights/` |
| `mcp-server/**` | `mcp-server/insights/` |
| `scripts/`, `.github/`, `docker-compose.yml`, root config, or anything cross-cutting | `insights/` (root) |
| `server/clones/**` | **never write** |

`repo-intel` is a server module (`server/src/modules/repo-intel/`), not a
top-level package — it routes to `server/`.

Determine the module from the files edited this session; fall back to
`git status` or `git diff --name-only`. If one session touched several modules,
each insight goes to the single module it concerns — never duplicated across files.

## The five gates

An insight is written **only if all five pass**.

1. **Non-trivial** — *"if this would be obvious to anyone reading the code, don't
   write it."*
2. **Actionable cold** — a future session reads it with zero conversation
   context and knows what to do.
3. **Abstracted** — record the reusable rule, not the story of finding it.
4. **Not already recorded** — run
   `${CLAUDE_SKILL_DIR}/scripts/list-entries.sh` (read-only) and check the target
   module's folder *and* the root folder. Already there → **write nothing**. Refines an
   existing entry → append a dated sub-note per rule 3 above.
5. **Significant** — *"if this were lost, would a future session go wrong?"*

See [reference/examples.md](reference/examples.md) for the quality bar, worked
examples from this repo, and what never gets an entry.

### Writing nothing is a correct outcome

Most sessions produce no insight worth keeping. When nothing clears the gates,
say "nothing new to capture" and **write nothing**. Do not lower the bar to
produce output, and do not restate something already recorded.

## When to capture

- **During the task** — the moment something non-obvious is discovered and
  confirmed. Capturing immediately survives compaction.
- **At the end of the task** — one sweep for anything missed.

Only capture what was *confirmed*: a fix that actually worked, or a dead end
actually ruled out. Untested hypotheses belong in **Open Questions**, if anywhere.

## Which section

The section decides the file — there is no other routing step.

| Section | File | What belongs there |
|---|---|---|
| **What Works** | `INSIGHTS.md` | Approaches that worked and are worth reusing |
| **Codebase Patterns** | `INSIGHTS.md` | Conventions and architectural decisions in this repo |
| **Session Notes** | `INSIGHTS.md` | Dated one-line record of a session that changed something material |
| **Open Questions** | `INSIGHTS.md` | Unresolved, worth investigating |
| **What Doesn't Work** | `gotchas.md` | Dead ends and antipatterns. **Most-skipped, most-valuable — never leave a real failure unrecorded** |
| **Tool & Library Notes** | `gotchas.md` | Quirks of dependencies, tooling, local environment |
| **Recurring Errors & Fixes** | `gotchas.md` | Error message → cause → fix; keep the literal error text greppable |

Entries written before these sections existed sit below an `## Earlier entries`
divider at the end of `gotchas.md`. **Leave them exactly where they are** — they
are not migrated.

## Entry format

```markdown
- YYYY-MM-DD — one-line claim, with `file:line` evidence where it applies.
```

Lead hard constraints with **NEVER** or **ALWAYS** — absolute directives survive
skimming. Keep it to a few lines; if it needs more, it probably belongs in
`docs/`.

## Size — report, never prune

Past roughly **30 entries** in one file, `list-entries.sh` prints a note. When it
does: tell the human the file is getting long and name consolidation candidates
(near-duplicates, contradictory pairs). **Then stop.** The human decides what, if
anything, goes. Never delete or merge entries on your own — pruning is a
deliberate human maintenance pass, never a side effect of capture.

## Promotion to CLAUDE.md

If an entry keeps causing repeated mistakes it may belong in a `CLAUDE.md`, which
is loaded into every session. **Name it as a promotion candidate and stop.** Never
edit any `CLAUDE.md` — that file's context budget is a human decision.
