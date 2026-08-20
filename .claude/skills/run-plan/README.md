# Run Plan Skill

Implementation Plan executor for the DevDigest project. One command takes an **already-approved**
plan and drives it to reviewed code — dispatching the implementer/reviewer agents, keeping its own
context lean (only short agent reports), and resolving review comments in a bounded fix loop.

Spec authoring (`spec-creator`) and planning (`implementation-planner`) are run **separately and
manually** beforehand. This command starts from the plan.

## What it does

Runs in the main session as the **orchestrator**. It never implements or reviews itself — it spawns
the agents, runs independent ones concurrently, and resolves architecture-review + traceability
comments through a bounded fix loop. It never pushes or merges.

```
args: plan:<path>  [spec:<path>]  [design:<path|url>]…  [mode:multi|single]  [max-fix:N]
  └─ read plan (tasks · DAG · owned paths · execution mode · AC ids) + baseline ./scripts/verify.sh
       └─ implementer-backend / implementer-ui ×N   (parallel by DAG + non-overlapping owned paths)
            └─ phase gate: ./scripts/verify.sh   (the only check that spans tasks)
                 └─ architecture-reviewer ‖ plan-verifier   (parallel, read-only, Sonnet)
                      └─ fix loop ×≤max-fix   (implementers fix crit/high + missing/partial
                                               → verify.sh → re-review only changed files)
                           └─ final report  +  "run pr-self-review before push"
```

## When to invoke

- `/run-plan plan:docs/plans/<feature>.md` (optionally `spec:specs/<…>.md`, `mode:single`, `max-fix:2`)
- Phrases: "run the plan", "execute the plan", "implement docs/plans/<x>.md".

## Inputs

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Approved Implementation Plan. **Required.** | — |
| `spec:<path>` | Spec behind the plan, so `AC-N` ids reach the gates | the spec cited in the plan |
| `design:<path\|url>` | Design source, repeatable; reaches UI tasks only | — |
| free-text prose | Notes/constraints for this run — constraints, never new scope | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode | read from plan |
| `max-fix:<n>` | Cap on the fix loop | `3` |

## Agents orchestrated

| Stage | Agent | Model | Role |
|-------|-------|-------|------|
| Build | `implementer-backend` ×N | sonnet | One task each — `server/`, `reviewer-core/`, `mcp-server/`, `e2e/`, contracts; parallel by non-overlapping owned paths; self-verifies |
| Build | `implementer-ui` ×N | sonnet | One task each — `client/`; same parallel rules |
| Review | `architecture-reviewer` | sonnet | Structural contracts (read-only) |
| Review | `plan-verifier` | sonnet | Requirement traceability / completeness (read-only) |
| Fix | implementer (either) ×N | sonnet | Resolve critical/high + missing/partial findings |

**Not invoked here:** `spec-creator`, `implementation-planner` (run manually beforehand), and
`test-writer` (dedicated test authoring is intentionally disabled to save tokens — coverage comes
from each implementer's self-verification). The price of that trade is stated, not hidden: acceptance
criteria no existing test exercises are listed in the final report as **unproven**.

## Guardrails

- Starts from a plan — never authors a spec or a plan.
- The orchestrator dispatches only: no editing product code, no reading `src/**`, not even a one-line
  fix. Heavy work stays isolated per agent.
- Never `git push`, merge, or open a PR — ends with a recommendation to run `pr-self-review`.
- Fix loop is bounded by `max-fix`; remaining findings are reported for a human, never looped forever.
  A round with no progress breaks the loop early and is flagged as stuck.
- Concurrent implementers must own non-overlapping paths.
- `./scripts/verify.sh` runs at baseline, between phases, and after each fix round — implementers
  verify only their own paths, so this is the only thing that catches breakage between them.

## File structure

```
run-plan/
├── SKILL.md     ← orchestrator — phased execution algorithm + bounded fix loop
├── tile.json    ← skill metadata
└── README.md    ← this file
```

## Relationship to `pr-self-review`

`run-plan` builds and reviews a feature **before** push (deep structural + traceability gate via the
dedicated agents). `pr-self-review` is the **broad pre-push gate** (security, npm audit, contract
sync, test-coverage, react/next checks) that runs at `git push`. Run `run-plan` to build the feature,
then `pr-self-review` as the final gate before pushing.
