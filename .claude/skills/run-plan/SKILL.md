---
name: run-plan
user-invocable: true
version: "0.1.0"
description: >
  Runs an already-approved DevDigest Implementation Plan end-to-end: dispatches implementer agents
  per the plan's DAG (multi-agent by non-overlapping owned paths, or single-agent), then gates with
  architecture-reviewer + plan-verifier + per-bucket quality reviewers in one parallel batch, then
  resolves their comments in a bounded fix loop. Starts FROM a plan — spec authoring (spec-creator) and planning (implementation-planner) are
  run separately/manually beforehand. Never pushes or merges.
  TRIGGER when: "run the plan", "/run-plan", "execute the plan", "implement this plan",
  "implement docs/plans/<x>.md", "run-plan plan:<path>".
  Does NOT cover: writing specs, writing the plan, authoring tests (test-writer is not invoked here),
  pushing/merging (run pr-self-review before push).
---

# Run Plan — Implementation Plan executor

> **Take an approved Implementation Plan and drive it to reviewed code: implement per the DAG, gate
> with architecture-reviewer + plan-verifier + quality-bucket reviewers in one batch, and resolve
> their comments in a bounded fix loop.**

You are the **orchestrator**, running in the main session. The spec and the plan already exist and
were approved by a human beforehand (you run `spec-creator` and `implementation-planner` separately —
they are **not** part of this command). You do **not** implement or review yourself — you dispatch the
specialized agents and keep only their short final reports in context, so your context stays lean and
cheap. Spawn agents with the `Agent` tool; run independent agents **concurrently** (multiple tool
calls in one message).

## Inputs (args)

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Path to the approved Implementation Plan. **Required.** | — |
| `spec:<path>` | The spec the plan was built from, so the `AC-N` ids reach the gates. | the spec cited in the plan's `Requirements (verified)`, if any |
| `design:<path\|url>` | Design source (screenshot, Figma link, mockup). Repeatable. Passed **only to UI tasks**. | — |
| free-text prose | Optional notes / constraints for this run (e.g. "skip phase 3 for now"). | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode. | read from the plan |
| `max-fix:<n>` | Cap on the fix loop (Step 3). | `3` |

If no `plan:` is given, ask for the plan path and stop — do not guess. State your interpretation of
the args in one line before starting.

Free-text prose is a **constraint on the existing plan, not new scope**. If a note implies work no
task covers, say so and stop — that is a re-plan for `implementation-planner`, not something to
improvise into a task.

## Guardrails (always)

- **Starts from a plan.** Do not author a spec or a plan here. If the plan is missing or unreadable,
  stop and say so.
- **You dispatch; you do not code and you do not read source.** No `Edit`/`Write` on product code, no
  `Read` on `src/**` — not even for a one-line fix that "would be faster to just do". You are the most
  expensive context in the run; every file read and every line written belongs inside a subagent.
- **No test-writer.** A dedicated test-authoring pass is intentionally disabled for this command.
  Coverage comes only from each implementer's self-verification (the tests covering its own paths +
  typecheck). Do not spawn `test-writer`. Say plainly in the final report which acceptance criteria
  ended up **unproven** because of it.
- **Never `git push`, merge, or open a PR.** The run ends at a review-clean working tree plus a
  recommendation to run `pr-self-review`.
- **Bound the fix loop** to `max-fix` iterations. Never loop forever; if findings remain, stop and
  report them for a human.
- **Respect owned-path non-overlap** whenever you run implementers concurrently.
- **Keep context lean.** Hold the plan path and each agent's short report — never paste an agent's
  full working transcript back into your own reasoning.

## Execution algorithm

### Step 0 — Read the plan and take a baseline

Read the plan file. Extract for every task: `T-id`, `Action`, `Module`, `Agent`, `Skills to use`,
`Owned paths`, `Depends-on`, `Known gotchas`, `Acceptance` (with the `AC-N` ids it satisfies). Read
the plan's `## Execution mode` field; a `mode:` arg overrides it. Build the dependency DAG from
`Depends-on`. If `spec:` was given or cited, extract the `AC-N` list; if the plan carries no AC ids,
note that traceability will be checked against R-items only.

Then:

- `git branch --show-current` — if it is `main`, stop and ask for a branch first.
- **Baseline:** run `./scripts/verify.sh` (~20s, typecheck + unit across every package). Record which
  checks were already failing. A pre-existing failure must never be attributed to a task later.

Print a one-line summary of what will run (e.g. "6 tasks, multi-agent, 3 phases; fix loop max 3").

### Step 1 — Implement

Pick the agent per task from its `Agent` field: **`implementer-backend`** (`server/`,
`reviewer-core/`, `mcp-server/`, `e2e/`, contracts) or **`implementer-ui`** (`client/`). If a plan
predates that field, route by module.

**Multi-agent mode** (default when the plan says so):

1. Find the **ready set** — tasks whose `Depends-on` are all complete and whose `Owned paths` do not
   overlap any task already running this batch.
2. Spawn one implementer per ready task, **concurrently** (one message, multiple `Agent` calls).
   Give each implementer its full task block, the **AC text** for every id its `Acceptance` cites,
   **plus the list of the other tasks' `Owned paths`** so it stays in its lane. Design sources go to
   UI tasks only. Never paste the whole plan or the whole spec into a task prompt.
3. Wait for the batch, collect reports, mark tasks done.
4. **Phase gate:** run `./scripts/verify.sh` and compare against the baseline. Implementers verify
   only their own paths by design, so this is the only thing that catches breakage *between* tasks.
   Route each new failure to the agent whose `Owned paths` contain the failing file.
5. Repeat from (1) until all tasks are complete.

**Single-agent mode:** run the tasks sequentially in plan order, one implementer at a time; still run
the phase gate between phases.

Each implementer self-verifies before returning. If one reports **blocked / failing** and cannot fix
it in scope: record it, and either dispatch a targeted retry or surface it to the user — do not
silently continue past a red task that others depend on.

### Step 2 — Review gate (parallel, read-only)

Compute the **changed-file set**: `git diff --name-only $(git merge-base origin/main HEAD)` plus
untracked files, cross-checked against the implementer reports. Then spawn, **concurrently in one
message**:

- **`architecture-reviewer`** on the changed-file set → structural findings (severity + rule) and a
  PASS/FAIL gate.
- **`plan-verifier`** with the plan, the spec, and the changed set → a traceability matrix and a
  PASS/FAIL/REVIEW gate.
- **Quality buckets** — split the changed files into UI (`client/`) and backend (everything else)
  buckets and spawn one read-only `general-purpose` reviewer per non-empty bucket, mirroring
  `pr-self-review`'s routing: the UI bucket carries `frontend-architecture`,
  `react-best-practices`, `next-best-practices`, `react-testing-library`; the backend bucket
  carries `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`; both carry
  `typescript-expert`, `zod`, `security`, plus the touched modules' `insights/` as extra criteria.
  Require structured findings (`{file, line, severity, skill, issue, fix}`), scoped to
  added/modified lines only, with the plan's known accepted decisions listed as do-not-report.

All of these run read-only on Sonnet with structured prompts, so batching them costs wall-clock
only — and catching a quality/security finding here, in the same cycle as the structural and
traceability gates, avoids a second review→fix→gate cycle when `pr-self-review` runs later (that
gate still runs before push; its reviews should come back clean). Collect every verdict.

### Step 3 — Fix loop (bounded — this is where review comments get resolved)

Build the **fix backlog**:

- `architecture-reviewer` findings with severity **critical** or **high** (medium/low → report only).
  A finding whose rule is `cannot-verify` or `undocumented-contract` is **not** actionable — it is a
  note for the user, because acting on an uncited opinion is how architecture churn starts.
- `plan-verifier` rows with status **missing** or **partial** (a requirement is not actually met).
  `cannot-verify` rows are not fixable by looping — they become the *unproven* list in the report.
- Quality-bucket findings with severity **CRITICAL** or **HIGH** (MEDIUM/LOW → report only, unless
  the user asks for them). A quality finding that contradicts a decision recorded in the spec or
  plan is not actionable — it is a note for the user.

If the backlog is empty → go to Step 4. Otherwise loop, for iteration `i = 1 … max-fix`:

1. **Group** findings by file / owned-path into non-overlapping fix tasks — one agent per file
   cluster, never one per finding.
2. **Dispatch implementers** — one per group, concurrent where owned paths are disjoint — each
   instructed: *"Fix exactly these findings in these files, stay in scope, self-verify. Do not
   refactor anything else. If a finding cannot be fixed inside your Owned paths, report it blocked
   rather than widening your scope."* Pass each finding's text, `file:line`, the reviewer's
   recommendation, and for a `missing`/`partial` row the AC text and what the verifier said is absent.
3. Each fix implementer self-verifies (tests covering its paths + typecheck).
4. Run `./scripts/verify.sh` — a fix that breaks the build is worse than the finding it fixed, and
   catching it costs 20 seconds.
5. **Re-review only the changed files**: re-run `architecture-reviewer` scoped to the files the fixes
   touched (plus any file a fix newly imported); re-run `plan-verifier` only for the requirements that
   were `missing`/`partial`; re-check quality findings only in the buckets whose files a fix touched —
   a pure test addition needs no quality re-review, and a finding whose fix landed with a named
   passing test can be closed on the implementer's report alone. Findings carried forward are not
   re-derived.
6. Recompute the backlog:
   - empty → **break (gate PASS)**.
   - non-empty but **no progress** since last iteration (the same findings unresolved — the
     implementer reports fixed and the reviewer reports it again) → break and flag as stuck. That
     pattern means the fix and the finding disagree about what the rule requires, and another
     iteration will not settle it; quote both sides.
   - otherwise → continue to the next iteration.

If `max-fix` is reached with a non-empty backlog → stop and list the remaining findings for a human
decision. Never exceed the cap, and never quietly report PASS.

### Step 4 — Final report

Output the summary below and recommend running **`pr-self-review`** before push. Do **not** push,
merge, or open a PR. Offer to invoke `pr-self-review` as the next step. Insights are recorded by the
implementers that hit them — do not duplicate their entries.

## Output format (final report)

```
## Run Plan — <feature>

- **Plan:** `docs/plans/<feature>.md` — mode: multi-agent | single-agent
- **Spec:** `specs/<…>.md` (AC ids traced) | none cited
- **Implemented:** <N> tasks (T1…Tn) — <one line>
- **Self-verify:** module suites + typecheck green | failing (<detail>)
- **Phase gate:** `./scripts/verify.sh` pass | fail (baseline was already failing: <list, or none>)

### Review gate
- architecture-reviewer (sonnet): PASS | FAIL — <crit/high counts>
- plan-verifier (sonnet): PASS | FAIL | REVIEW — <verified N/M; missing/partial ids>
- quality buckets (sonnet): <UI: C/H/M/L counts> · <backend: C/H/M/L counts> | bucket empty

### Fix loop
- iterations run: <i> / <max-fix>
- resolved: <findings fixed>
- **remaining (needs human):** <list, or "none">

### Unproven acceptance criteria
- <AC-N — implemented, but no existing test exercises it (test-writer not run), or "none">

### Next step
Run `pr-self-review` before pushing. (Not pushed — by design.)
```

## When you cannot proceed

If `plan:` is missing or the plan is unreadable, or an implementer is blocked on something only a
human can decide — stop and say plainly what you need. A clear "blocked here, need X" is a valid
result; a half-run pretending to be complete is not.
