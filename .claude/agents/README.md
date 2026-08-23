# DevDigest Agents

Custom Claude Code subagents for the DevDigest project. Each agent is a Markdown file with YAML
frontmatter (`name`, `description`, `model`, `tools`, optional `skills:`) plus a system-prompt body.
Claude routes work to an agent based on its `description`, so the descriptions are written as
trigger rules ("Use proactively when…").

| Agent                                                   | Model  | Role                                                                                                              | Writes code?            |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [`researcher`](./researcher.md)                         | sonnet | Read-only research (project + internet), strict structured output                                                 | No                      |
| [`spec-creator`](./spec-creator.md)                     | opus   | Authors the spec — WHAT/WHY, EARS acceptance criteria with `AC-N` ids                                             | No (only the spec file) |
| [`implementation-planner`](./implementation-planner.md) | opus   | Read-only architect — verifies requirements and produces a structured Implementation Plan (does not author specs) | No (only the plan file) |
| [`implementer-backend`](./implementer-backend.md)       | sonnet | Implements ONE backend task (server · reviewer-core · mcp-server · e2e · contracts)                               | Yes                     |
| [`implementer-ui`](./implementer-ui.md)                 | sonnet | Implements ONE UI task (client)                                                                                   | Yes                     |
| [`plan-verifier`](./plan-verifier.md)                   | sonnet | Read-only completeness / traceability check — runs alongside architecture-reviewer                                | No                      |
| [`architecture-reviewer`](./architecture-reviewer.md)   | sonnet | Read-only structural/architecture review of a diff or file set                                                    | No                      |
| [`architecture-reviewer-lite`](./architecture-reviewer-lite.md) | haiku | Same seven rules and report format, compact prompt, one preloaded skill — for PR-sized diffs; compared against the full reviewer in `evals/agents/` | No                      |
| [`test-writer`](./test-writer.md)                       | sonnet | Writes unit + integration tests, names them after `AC-N` — **not invoked by `/run-plan`**                          | Yes                     |
| [`doc-writer`](./doc-writer.md)                         | sonnet | Writes documentation (Diátaxis + Mermaid), knows where docs belong                                                | Yes                     |

## Intended workflow

Spec-Driven Development, one artifact per stage. The two authoring stages are **manual** — a human
reviews their output before any code exists; everything after them runs as one command, `/run-plan`.

```
MANUAL, one at a time, each in its own chat:

you  →  spec-creator (opus)             → specs/<date>-<feature>.md   [WHAT/WHY, AC-N]
          └─ you review the spec
     →  implementation-planner (opus)   → docs/plans/<feature>.md     [HOW]
          (verifies requirements · carries AC-N into R-items · recommends ·
           ASKS the execution mode; phased tasks with Agent · Skills ·
           Owned paths · Depends-on · Acceptance → satisfies AC-N)
          └─ you review the plan

ONE COMMAND, fresh chat:
   /run-plan plan:docs/plans/<feature>.md [spec:…] [design:…] [mode:…] [max-fix:N]

     ├─ per phase: implementer-backend / implementer-ui (sonnet), parallel by DAG +
     │    non-overlapping Owned paths, each verifying only its own paths
     │    └─ ./scripts/verify.sh — phase gate, run by the orchestrator (~20s)
     ├─ architecture-reviewer ‖ plan-verifier (sonnet, read-only, one message)
     │    └─ backlog = crit/high findings + missing/partial ACs
     │         └─ fix loop ≤ max-fix (default 3): scoped fix tasks → verify.sh
     │              → re-review ONLY the touched files / affected ACs
     │              → no progress in a round ⇒ break early, flagged stuck
     └─ final report — including acceptance criteria left unproven

     →  /pr-self-review   — final gate before push (hook-enforced), run manually
```

Not invoked by `/run-plan`, to save tokens: `test-writer` (run it manually when you want behavioural
proof) and `doc-writer`. Skipping the test writer has a visible price — acceptance criteria no
existing test exercises are reported as **unproven**, never as verified.

**Why the two gates run in parallel.** Both are read-only, both are on Sonnet, and they answer
different questions (is it *complete* vs is it *structured right*), so sequencing them buys nothing
and costs wall-clock. Their findings merge into one backlog, which is what makes a single fix round
able to resolve both.

**Where test-writer would slot in.** Both gates precede it, and that ordering still matters when you
run it by hand: a test written against a missing AC either does not exist (a silent hole) or asserts
a stub. plan-verifier proves the artifacts *exist*; test-writer proves they *behave* — which is why
its tests carry the AC id, turning `cannot-verify` rows into `done` on a re-run. With it off, those
rows stay open and `/run-plan` reports them as unproven.

**Traceability is one thread, and every stage must carry it:**

```
AC-3 (spec) → R2 "covers AC-3" (plan) → task Acceptance "satisfies AC-3"
            → it('AC-3: …') (test) → matrix row AC-3 = done (plan-verifier)
```

The pipeline mirrors Claude Code's recommended **Explore → Plan → Implement → Commit** loop.
Requirements (the _what/why_) are an **input** to the planner — it never authors or edits a
specification.

## Cost discipline

Three rules keep a multi-agent run affordable, all encoded in the agent bodies and in `/run-plan`:

0. **The orchestrator dispatches; it does not read source or edit code.** It is the most expensive
   context in the run. Every file read and every line written happens inside a subagent — including
   the one-line "it's faster if I just fix it myself" edits, which are exactly how an orchestrator
   context balloons.

1. **Implementers never run the project-wide gate.** `pnpm typecheck` is project-wide, so with
   parallel implementers on one branch agent A fails on agent B's in-flight file — and "iterate
   until green" then drags A outside its `Owned paths`. Implementers run
   `vitest related --run <their files> --reporter=dot`; the orchestrator runs `./scripts/verify.sh`
   once per phase.
2. **Preloaded skills are the real per-agent cost**, not test output. The two implementers preload
   only what their type always needs (~11k / ~9k tokens); large situational skills
   (`postgresql-table-design`, `react-testing-library`, `security`, `zod`) are invoked on demand via
   the `Skill` tool. That is why the planner **must** name them in each task's `Skills to use` — an
   on-demand skill nobody names is a skill nobody loads.

---

## `researcher`

Pre-existing read-only research agent. Finds information inside the project or on the public
internet and returns it in a strict template. Never edits files, never runs deep-research. The
implementation-planner and implementers both follow its writing conventions (YAML frontmatter +
Hard rules + fixed output template).

---

## `spec-creator`

**What it does.** Front of the chain. Turns a request plus design sources (pasted text, Figma links,
screenshots, existing docs) into **one spec file** — the WHAT and WHY, never the HOW. Every
acceptance criterion is a single EARS statement with an `AC-N` id and an `observable:` verification
hint; every user story maps to an AC, and every edge case is either covered by an AC or explicitly
marked accepted. It analyses the design for gaps, corner cases, cross-module interactions, and UX
problems, asks blocking questions with `AskUserQuestion`, and leaves the rest as
`[NEEDS CLARIFICATION]`. Writes only under a `specs/` directory — with one exception worth knowing:
an e2e-only spec goes to `e2e/docs/`, because `e2e/specs/` holds agent-browser *flow* specs.

**Why the AC ids matter.** They are the thread the whole pipeline pulls on (see *Intended
workflow*). An AC that no single test could assert is a spec bug — split it, or say in its
`observable:` hint that it is not machine-verifiable.

---

## `implementation-planner`

**What it does.** Turns an **agreed set of requirements** (a spec, ticket, or clear request) into a
structured, file-specific **Implementation Plan** written to `docs/plans/<feature>.md`. It does
**not** author or edit specifications — requirements are an _input_ it plans against. Before
planning it (1) **verifies the requirements** — restating them, flagging gaps, asking 1–4 clarifying
questions with `AskUserQuestion`, and offering recommendations for a better approach — and (2)
**asks the execution mode**: multi-agent (parallel implementers, strictly non-overlapping
`Owned paths`) or single-agent (one linear pass). Both steps need a real answer, which is why the
agent carries `AskUserQuestion`: a planner that cannot ask simply assumes, and records the
assumption as a decision. It knows every DevDigest module (`server/`, `client/`, `reviewer-core/`,
`mcp-server/`, `e2e/`, `@devdigest/shared`) and assigns each task an `Agent`, a skill set, owned
paths, dependencies (a DAG), known gotchas from module insights, and measurable acceptance criteria
tied to `AC-N`. Read-only except for the plan file.

**Carries the union of both implementers' skill sets** plus `mermaid-diagram`, on purpose: it plans
the implementation, so every practice an implementer must follow has to be reflected in the plan. It
also knows which skills each implementer preloads and which are on demand — the ones it must name in
a task's `Skills to use` for them to be loaded at all.

**Based on:**

- **`description` as the routing signal**, written as a trigger rule — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Read-only planning, separated from implementation** (Explore → Plan → Implement) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); modelled on the built-in `Plan` subagent — [subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Opus for design/architecture** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Handoff via a written plan artifact** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Strong plan structure** (overview, requirements, file-specific steps, phases, dependencies, testing, risks, success criteria) — [affaan-m/everything-claude-code · planner.md](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md)
- **Plan anti-patterns → the Red-flags check** (measurable acceptance, every requirement maps to a task, dependencies form a DAG) — [Strategic Task Planner (subagents.app)](https://subagents.app/agents/planner)
- **Preloading skills via the `skills:` field** (full skill body injected at startup) — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Delegating heavy discovery to a subagent** to keep planning context clean — [subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Module-scoped insights** (read `<module>/insights/` rather than the whole repo) — project convention in [`/CLAUDE.md`](../../CLAUDE.md) "Insights protocol", combined with the nested-skills pattern from [Extend Claude with skills](https://code.claude.com/docs/en/skills)

---

## `implementer-backend` · `implementer-ui`

**What they do.** Each implements exactly one task from an Implementation Plan and brings it to
green — `implementer-backend` for `server/`, `reviewer-core/`, `mcp-server/`, `e2e/` flow specs and
`@devdigest/shared` contracts; `implementer-ui` for `client/`. They run in parallel with each other
on the **same branch** (no worktree isolation), so staying inside the task's `Owned paths` is what
keeps the parallel run safe.

**Why two agents and not one.** A single implementer preloaded every backend *and* every UI skill —
~27.6k tokens per instance, of which roughly a third could never apply to the task at hand,
multiplied by every parallel agent. Splitting by type takes the preload to ~11k (backend) and ~9k
(UI), and removes the "emphasise the right subset" instruction entirely: the routing is the agent
choice, which the planner already makes per task.

**Skill routing.** Each agent preloads only what its type always needs. Large situational skills are
invoked on demand through the `Skill` tool, triggered by the task's `Skills to use` field:

| Agent | Preloaded | On demand |
|---|---|---|
| `implementer-backend` | onion-architecture · fastify-best-practices · drizzle-orm-patterns · zod · typescript-expert · engineering-insights | postgresql-table-design (schema work) · security (untrusted input, secrets, new public route) |
| `implementer-ui` | frontend-architecture · next-best-practices · react-best-practices · typescript-expert · engineering-insights | react-testing-library (writing a `*.test.tsx`) · zod · security |

**Verification is narrow, by design.** They run
`vitest related --run <their files> --exclude '**/*.it.test.ts' --reporter=dot` (the exclude matters:
without it `related` drags in the testcontainers suite — 1.4s becomes 17.7s and needs Docker) and
treat a failure outside their `Owned paths` as someone else's — never running
`./scripts/verify.sh`, a bare `pnpm test`, the `.it.test.ts` suite, or `./scripts/e2e.sh`. Those are
the orchestrator's phase gate. A project-wide `tsc` is unavoidable (that is the only mode it has),
so the rule is: fix only diagnostics inside your own paths, report the rest.

**Based on:**

- **`description` as a trigger rule** for auto-delegation — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Sonnet for implementation** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Per-type skill sets injected via `skills:`, situational ones left on demand** — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Owned paths / forbidden files / contracts-first** for safe parallel work — [Parallel Claude Code Agents: Safe Workflow Guide](https://www.aakashx.com/blog/parallel-claude-code-agents/)
- **Self-verification with a runnable check**, scoped to the agent's own paths — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Review in a fresh context, separate from the author** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); kept in the existing `pr-self-review` skill rather than baked into this agent
- **Single-responsibility agent design** (one task, in scope) — [wshobson/agents](https://github.com/wshobson/agents), [PubNub best practices](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Module-scoped insights read before coding, written back after** — project convention in [`/CLAUDE.md`](../../CLAUDE.md) + the `engineering-insights` skill

**Deliberately not used:** `isolation: worktree` (the project runs implementers on the main branch
by choice, relying on `Owned paths` discipline instead of worktree isolation).

---

## `test-writer`

**What it does.** Adds or extends tests for the DevDigest backend (`server/`), the LLM review engine
(`reviewer-core/`), and the web client (`client/` — React components and hooks via vitest + jsdom +
React Testing Library). It enforces the project's test split (`*.it.test.ts` = real Postgres via
testcontainers with transaction-rollback isolation; `*.test.ts` = hermetic unit with fake timers and
seeded ids; client tests are always hermetic, RTL-driven, querying by accessible role/text and
mocking only I/O seams), injects a `FakeLlmProvider` at the `LLMProvider` seam for reviewer-core
tests, and never modifies production `src/` files (only a type export strictly
required to compile a test is permitted). Forbidden anti-patterns are encoded directly in its body:
tautological assertions, over-mocking, snapshot tests on dynamic output, and non-deterministic test
bodies. Self-verifies by running the affected suites (`--reporter=dot`, never the whole gate) and
pasting terminal evidence before reporting done.

**Not invoked by `/run-plan`** — run it manually when you want behavioural proof. Skipping it is a
deliberate, *visible* trade: every AC without a test is reported as unproven. Where an AC really must
be proven inside a `/run-plan` run, put "add a test for AC-N" in that task's `Acceptance` and the
implementer writes it inline, with no extra agent spawn.

**Runs after the gates pass, and closes traceability.** It receives the spec's acceptance
criteria, not just a diff, and prefixes every AC-proving test with its id — `it('AC-3: …')` — so a
passing suite becomes greppable evidence for the exact criteria `plan-verifier` could only mark
`cannot-verify` on static reading. An AC no test can express is reported, not faked.

**Skill routing.** `react-testing-library` supplies RTL and vitest query conventions; `fastify-best-practices`,
`drizzle-orm-patterns`, and `onion-architecture` anchor the backend test structure to the actual layering;
`zod` and `typescript-expert` cover schema-level assertions; `security` and `engineering-insights`
are the always-on set.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Over-mocking and tautological-test study** — [Are Coding Agents Generating Over-Mocked Tests? (arXiv)](https://arxiv.org/html/2602.00409v1)
- **Tautological-test postmortem (contract-comment-before-assertion rule)** — [When AI-generated tests pass but miss the bug (dev.to)](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp)
- **Mocking LLM calls for deterministic tests** — [Unit testing AI agents: mocking LLM calls (CallSphere)](https://callsphere.ai/blog/unit-testing-ai-agents-mocking-llm-calls-deterministic-tests)
- **Blazing-fast Postgres tests with testcontainers + Vitest** — [Blazing fast Prisma and Postgres tests in Vitest (Codepunkt)](https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/)
- **Flaky-test prevention in Vitest** — [Flaky tests in Vitest (Mergify)](https://mergify.com/flaky-tests/vitest/)

---

## `architecture-reviewer`

**What it does.** A **read-only** structural auditor (`tools: Read, Glob, Grep` — no `Edit`,
`Write`, or `Bash`). It runs after `plan-verifier` PASS, audits the changed-file set the caller
passes (never the whole repo), and reads the project's authoritative docs **only for the modules
that set touches** — always root `CLAUDE.md`, plus `server/CLAUDE.md`, `reviewer-core/CLAUDE.md`,
`client/CLAUDE.md`, and the repo's own `onion-architecture` skill as written statements of the
rules. It then checks seven named rules: inward-only dependencies, business logic in routes, DI
discipline, `process.env` outside the two files allowed to read it, `reviewer-core` zero-I/O,
`groundFindings()` gate, and shared-contract deduplication. Every finding must cite the exact rule
it violates, and a rule documented nowhere may not be raised as a violation at all — it becomes an
`undocumented-contract` info note. Write tools are deliberately omitted — a reviewer that can write
is tempted to fix rather than report, which destroys review independence; its findings go back as
scoped implementer tasks.

**Scope.** Does NOT review style nits, naming, runtime bugs, test quality, performance, or security
injection vectors (those belong to `pr-self-review` and the `security` skill). Structural contracts
only.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Parallel AI agents for code review** — [9 Parallel AI Agents That Review My Code (HAMY)](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)
- **Architectural liquefaction and the need for automated guardrails** — [Clean Architecture in the Age of AI (dev.to)](https://dev.to/uxter/clean-architecture-in-the-age-of-ai-preventing-architectural-liquefaction-5d8d)
- **Enforcing Clean Architecture via tooling** — [Enforce Clean Architecture in TypeScript with fresh-onion (dev.to)](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi)
- **Agentic code review patterns** — [Agentic Code Review (Addy Osmani)](https://addyosmani.com/blog/agentic-code-review/)

---

## `plan-verifier`

**What it does.** A **read-only** completeness checker (`tools: Read, Glob, Grep, Bash` — no
`Edit` or `Write`), run **concurrently with `architecture-reviewer`** as the post-implementation
gate. Given a spec and its plan, it walks
every acceptance criterion (the plan's task → AC mapping tells it where each should have landed),
searches for the concrete implementing artifact (grep the AC id in test names → grep the symbol →
structural glob → read), quotes verbatim evidence, and assigns one of five statuses:
`done | partial | missing | cannot-verify | out-of-scope`. `Bash` is used only for search, a
targeted vitest run, or `./scripts/verify.sh` as evidence — never to modify state.
After the per-requirement pass it performs an implicit-concerns sweep (error handling, auth,
idempotency, test coverage, type safety). Output is a traceability matrix table followed by a gate
verdict.

**Skill routing.** The skill set is intentionally lean: `typescript-expert` to locate TypeScript
artifacts, `onion-architecture` to know where backend artifacts should live, and
`frontend-architecture` to locate UI artifacts. No architecture-quality or security skills are
loaded — those concerns belong to `architecture-reviewer` and `pr-self-review`. The body explicitly
states this agent's mandate is completeness and traceability only.

**Based on:**

- **Spec-driven development with AI** — [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **Writing acceptance criteria AI agents can verify** — [Acceptance criteria an AI agent can verify (BrainGrid)](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
- **Code search tool selection for AI agents** — [Code search for AI agents — which tool, when (ceaksan.com)](https://ceaksan.com/en/code-search-for-ai-agents-which-tool-when)
- **LLM behavioral failure modes (hallucination, rubber-stamping)** — [LLM behavioral failure modes (ceaksan.com)](https://ceaksan.com/en/llm-behavioral-failure-modes)
- **What AI verification still misses** — [AI coding agents can verify some of their work — here's what they still miss (dev.to)](https://dev.to/moonrunnerkc/ai-coding-agents-can-verify-some-of-their-work-now-heres-what-they-still-miss-58mc)
- **Requirements traceability matrix structure** — [How to create a traceability matrix (Perforce)](https://www.perforce.com/blog/alm/how-create-traceability-matrix)

---

## `doc-writer`

**What it does.** Writes and updates Markdown documentation for the DevDigest codebase. Every
claim is grounded in source (never invented); every doc is classified into a Diátaxis quadrant
(tutorial / how-to / reference / explanation) and placed according to the repo's layout decision
tree (`server/docs/`, `client/docs/`, `docs/adr/`, `docs/plans/`, `<module>/insights/`). ADRs are
append-only — accepted ones are never edited, only superseded. Every generated file is stamped with
`<!-- generated from: <source files> -->` on the second line. Mermaid diagrams are selected by
content type and validated with a post-check (unique node ids, no lowercase `end`, correct arrow
syntax) before publishing.

**Skill routing.** `mermaid-diagram` drives diagram type selection and syntax; `onion-architecture`
and `frontend-architecture` are loaded to accurately describe backend and UI module structure in
reference docs; `typescript-expert` enables accurate reading of TypeScript types and exported
symbols; `engineering-insights` closes the loop — doc-writing discoveries (undocumented constraints,
gotchas) are appended back to `<module>/insights/`.

**Based on:**

- **Diátaxis framework** — [Diátaxis — Start Here](https://diataxis.fr/start-here/)
- **Automated, grounded documentation generation (DocAgent)** — [DocAgent (arXiv)](https://arxiv.org/html/2504.08725v1)
- **AI doc generation: when it helps and when it misleads** — [AI can write your docs, but should it? (Mintlify)](https://www.mintlify.com/blog/ai-can-write-your-docs-but-should-it)
- **Architecture Decision Record conventions** — [Architecture Decision Record (Martin Fowler)](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
- **ADR best practices** — [Master ADRs (AWS)](https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/)
- **Avoiding AI writing pitfalls** — [avoid-ai-writing SKILL.md (GitHub)](https://github.com/conorbronsdon/avoid-ai-writing/blob/main/SKILL.md)

---

## Adding a new agent

1. Create `<name>.md` here with frontmatter (`name`, `description`, `model`, `tools`, optional
   `skills:`).
2. Write the `description` as a trigger rule — it is the only signal Claude uses to route to the agent.
3. If you preload skills, make sure none of them set `disable-model-invocation: true` (that blocks
   preloading). Preload only what the agent needs on *every* run — a large skill needed sometimes
   belongs in the body as an on-demand `Skill` invocation instead.
4. Reference only paths that exist. `Glob` before you write one into an agent body: a "read this
   first" list pointing at a missing file costs a failed tool call on every single run, and an agent
   that cannot find its grounding falls back on its priors.
5. Add a row to the table above and a section here, with sources if the design is based on external
   practices.
