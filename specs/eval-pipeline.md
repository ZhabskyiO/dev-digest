# Spec: Eval Pipeline (agent regression harness)   |   Spec ID: SPEC-2026-08-24-eval-pipeline   |   Status: implemented (retro-spec)
Supersedes: none

> **Retro-spec.** This document was written 2026-08-24, *after* the feature shipped, to
> record the agreed behavior in the repo's spec format. Acceptance criteria describe the
> implemented, test-verified behavior — they were not authored ahead of the code. File
> references point at the implementation as evidence.

## Problem & why

Changing an agent's system prompt, model, or linked skill today is a leap of faith: the
only way to know whether the change broke the reviewer is to re-run it on live PRs and
eyeball the findings. There is no number that moves when a prompt edit silently kills the
agent's ability to spot a hardcoded secret, and no record proving the old prompt was better.

Meanwhile the raw material for regression tests already exists in Postgres: every
accept/dismiss decision made on findings during L01–L05 is a labelled example. An accepted
finding is a positive ("the agent must find X at file:line"); a dismissed finding is a
negative ("the agent must NOT comment on Y"). Nothing turns those decisions into a
repeatable measurement.

This feature is Experiment 3 of the eval lab, rebuilt in the product plane: eval cases live
in Postgres next to the findings they were born from, a run executes the agent over every
case with fixed inputs, and scoring is **pure code — no model in the loop** — so two runs of
different agent versions are directly comparable ("old prompt vs new").

The storage and contract layer was handed in ready-made: tables `eval_cases` / `eval_runs`
(`server/src/db/schema/eval.ts`, shipped in migration `0000`) and the base Zod shapes
`EvalRun` / `EvalCase` / `EvalOwnerKind` (`contracts/knowledge.ts`) plus the L06 aggregate
in `contracts/eval-ci.ts`. This feature adds the producer, the scorer, and the UI.

## Goals / Non-goals

- **Goal:** One-click eval-case creation from a real, *decided* finding — accepted →
  `must_find`, dismissed → `must_not_flag` — freezing the diff fragment the finding was
  judged against.
- **Goal:** A run executes the agent over **all** cases of its set with fixed inputs (stored
  diff + the agent's own prompt/model/strategy/linked skills) so runs across agent versions
  are comparable.
- **Goal:** Code-only scoring: recall / precision / citation_accuracy computed from
  file+line-range matching, with dismissed-born cases feeding precision and the
  citation-grounding gate feeding citation_accuracy.
- **Goal:** Run history per agent with a side-by-side compare of any two runs.
- **Goal:** A workspace-level Eval Dashboard in the sidebar showing the latest evals across
  all agents.
- **Goal:** Fit the *given* schema unchanged — no new tables, no migrations.

- **Non-goal:** LLM-judge scoring of any kind. A finding is counted by exact-file +
  intersecting-line-range match, nothing else.
- **Non-goal:** Repo-intel / project-context enrichment during eval runs. Those depend on
  mutable index state and would break cross-version comparability (see AC-14).
- **Non-goal:** A manual case-authoring UI (the design mock's "New eval case" modal). The
  API endpoint exists (AC-13) but the shipped creation path in the UI is the FindingCard
  button only.
- **Non-goal:** The dashboard's "Run all agents" button and the compare modal's prompt-text
  diff / "Promote vN" action from the design mock — follow-ups, not shipped.
- **Non-goal:** Skill-owned eval sets. `eval_cases.owner_kind` supports `skill`, but this
  feature only ever writes `agent`.

## User stories

1. As a reviewer, I can turn a real finding into an eval case with one click: an accepted
   finding becomes "must find X at file:line", a dismissed one becomes "must NOT flag Y".
2. As an agent author, I can see every case in my agent's set, with its expectation type and
   the result of its last run.
3. As an agent author, I can run the agent over all its cases with one action.
4. As an agent author, I can read the run's metrics: recall, precision, citation_accuracy.
5. As an agent author, I can open the run history and compare two runs side by side —
   "old prompt vs new".
6. As a team member, I can open an Eval Dashboard from the sidebar and see the latest evals
   that were run across all agents.

## Data model (given, unchanged)

`eval_cases` (`server/src/db/schema/eval.ts`): workspace-scoped, `owner_kind`/`owner_id`
address the agent, `input_diff` holds the frozen unified-diff fragment, `expected_output`
holds the expectation (below), `input_meta` holds provenance.

`eval_runs`: one row **per case per run**, FK → case (cascade), metric columns + `pass` +
`actual_output` jsonb.

**Batch convention** — the schema has no batch table, so one press of "Run evals" writes N
per-case rows stamped with a shared `batch_id` (plus `agent_version`, `model`, `provider`)
inside `actual_output`, and duplicates the batch-level metrics onto every row's metric
columns. Batches are re-aggregated at read time (`modules/evals/helpers.ts::
groupRunsIntoBatches`); rows without the stamp are skipped, so pre-pipeline rows can never
form a phantom batch.

## Contracts

`contracts/eval-pipeline.ts` (canonical `server/src/vendor/shared`, synced byte-identical to
`client/src/vendor/shared`; both barrels export it):

- `EvalExpectation` — `{ type: 'must_find'|'must_not_flag', file, start_line, end_line,
  severity?, category?, title?, source_finding_id? }`; the `expected_output` payload.
- `EvalCaseSummary`, `EvalCaseLastRun`, `EvalCaseFromFinding`, `CreateEvalCaseBody`
- `EvalBatch`, `EvalBatchResult` (batch + the base `EvalRun` with `per_trace`)
- `EvalDashboardAgent`, `EvalPipelineDashboard`
- `EvalCaseOutcome` — the pure scoring input shape.

## API surface (`server/src/modules/evals/`)

| Route | Behavior |
|---|---|
| `POST /findings/:id/eval-case` | Case from a decided finding; idempotent per finding. 201 on create, 200 with `created:false` on repeat. |
| `GET /agents/:id/eval-cases` | The agent's case set + last-run status per case. |
| `POST /agents/:id/eval-cases` | Manual case authoring (validated `CreateEvalCaseBody`). |
| `DELETE /eval-cases/:id` | Remove a case; its runs cascade. |
| `POST /agents/:id/eval-runs` | Run the agent over ALL cases; persist one batch; 201 with `{batch, result}`. |
| `GET /agents/:id/eval-runs` | Batch history, newest first. |
| `GET /evals/dashboard` | Cross-agent aggregate for the sidebar page. |

All routes are workspace-scoped via `getContext` and validate `:id` as uuid (`IdParams`).

## Acceptance criteria (EARS)

### Case creation from a finding

- **AC-1:** WHEN `POST /findings/:id/eval-case` is called for a finding whose decision is
  *accepted*, the system **shall** create an `eval_cases` row owned by the producing agent
  whose `expected_output` has `type: must_find` and the finding's `file`/`start_line`/
  `end_line`, and respond 201.
- **AC-2:** WHEN the finding's decision is *dismissed*, the created expectation **shall**
  have `type: must_not_flag`.
- **AC-3:** WHEN the finding is undecided (neither accepted nor dismissed), the system
  **shall** reject with 400 and create nothing — the decision is what fixes the expectation
  type.
- **AC-4:** WHEN a finding carries both stamps (re-decided), the later timestamp **shall**
  win (`modules/evals/helpers.ts::decisionOf`).
- **AC-5:** WHEN a case already exists for the finding (matched via
  `input_meta->>'finding_id'`), the system **shall** return that case with `created: false`
  and **shall not** create a duplicate.
- **AC-6:** IF the finding's review has no `agent_id`, THEN the system **shall** reject with
  400 (no eval-set owner).
- **AC-7:** IF the PR has no stored `pr_files.patch` for the finding's file, THEN the system
  **shall** reject with 400 naming the file — an eval input that cannot be frozen is an
  error, not a silent empty case.
- **AC-8:** The case's `input_diff` **shall** be a self-contained single-file unified diff
  rebuilt as `diff --git a/<path> b/<path>` + `---`/`+++` headers + the stored patch —
  byte-compatible with what `parseUnifiedDiff` accepts (the same construction
  `diffFromPrFiles` uses in production).
- **AC-9:** The case name **shall** be the kebab-case slug of the finding title (≤ 60 chars,
  `eval-case` fallback), deduplicated within the agent's set as `slug-2`, `slug-3`, …
- **AC-10:** `input_meta` **shall** record provenance: `source:'finding'`, `finding_id`,
  `review_id`, `pr_id`, `pr_number`, `pr_title`, `decision`.
- **AC-11:** WHEN the finding belongs to another workspace, the system **shall** respond 404.

### Case set

- **AC-12:** `GET /agents/:id/eval-cases` **shall** return the agent's cases (name-ordered)
  with the parsed expectation (`null` when `expected_output` is malformed) and each case's
  latest run as `{run_id, ran_at, pass, findings_count}` or `null`; unknown agent → 404.
- **AC-13:** `POST /agents/:id/eval-cases` **shall** accept `{name, input_diff,
  expected_output: EvalExpectation, notes?}` (schema-first validation at the route) and
  create a manually-authored case (`input_meta.source: 'manual'`), 201.
- **AC-14 (deletion):** `DELETE /eval-cases/:id` **shall** remove the case and cascade its
  `eval_runs`; unknown id → 404.

### Runs — fixed inputs

- **AC-15:** WHEN `POST /agents/:id/eval-runs` is called, the system **shall** execute the
  agent over **every** case of its set through `reviewPullRequest` (the production engine:
  prompt assembly, injection guard, structured output, mandatory citation-grounding gate)
  with exactly: the case's stored diff, the agent's `system_prompt`, `model`, `strategy`,
  and its linked **enabled** skills — and **shall not** inject repo-intel, callers, or
  project-context, so runs of different agent versions are comparable.
- **AC-16:** WHEN the agent has no cases, the system **shall** reject with 400 telling the
  user to create cases from findings first.
- **AC-17:** The run **shall** persist one `eval_runs` row per case, all sharing one
  `batch_id`/`ran_at`, with per-case `pass`/`duration_ms`/`cost_usd`, the batch-level
  metrics duplicated onto each row's metric columns, and the kept findings + grounding-drop
  count + agent version/model/provider recorded in `actual_output` (see Data model).
- **AC-18:** The response **shall** be 201 with `{batch: EvalBatch, result: EvalRun}` where
  `result.per_trace` names each case with its `pass`, expected payload, and the actual kept
  findings (file/lines/severity/title).

### Scoring — fully in code

- **AC-19:** A finding **shall** satisfy an expectation iff `finding.file ===
  expectation.file` AND the inclusive line ranges intersect (order-insensitive bounds) —
  `modules/evals/scoring.ts::matchesExpectation`.
- **AC-20:** A `must_find` case **shall** pass iff ≥ 1 kept finding matches; a
  `must_not_flag` case **shall** pass iff 0 kept findings match — a finding elsewhere in the
  same diff does not fail it.
- **AC-21:** `recall` **shall** equal matched `must_find` cases / total `must_find` cases,
  and 1.0 when the set has none.
- **AC-22:** `precision` **shall** equal (total kept findings − noise) / total kept
  findings, where noise = findings matching a `must_not_flag` target; 1.0 when the batch
  emitted no findings. This is where dismissed-born cases do their work.
- **AC-23:** `citation_accuracy` **shall** equal findings surviving the grounding gate /
  all findings the model emitted (kept + dropped); 1.0 when nothing was emitted.
- **AC-24:** IF a case's `expected_output` fails to parse as `EvalExpectation`, THEN that
  case **shall** score as failed — a malformed expectation can never pass.
- **AC-25:** IF a case's `input_diff` parses to zero files, THEN that case **shall** score
  as failed with `error: 'input_diff_unparseable'` recorded, and the batch **shall**
  continue — one broken case never sinks the run.
- **AC-26:** IF any per-case cost is unknown (`null`), THEN the batch `cost_usd` **shall**
  be `null` — never a misleading partial sum (same rule as `agent_runs.cost_usd`).

### History & compare

- **AC-27:** `GET /agents/:id/eval-runs` **shall** return batches newest-first, each
  aggregating its rows: `passed`/`total`, summed `duration_ms`, cost per AC-26, plus
  `agent_version`/`model` — the "old prompt vs new" axis; rows without a batch stamp are
  skipped.
- **AC-28:** The AgentEditor **Evals** tab **shall** list the run history and let the user
  select exactly two runs; Compare **shall** open a modal showing the pair ordered old → new
  by `ran_at` with per-metric percentage-point deltas and passed/total.

### Dashboard & UI

- **AC-29:** `GET /evals/dashboard` **shall** return, for every agent with cases or
  batches: `cases_total`, the latest batch, deltas vs the previous batch (null with < 2
  batches), and a chronological recall trend (≤ 12 points) — plus the ≤ 8 most recent
  batches across all agents.
- **AC-30:** The FindingCard **shall** show a "Turn into eval case" action only where the
  surface wires a handler; it **shall** be disabled (with a hint) until the finding is
  decided, and success/already-exists/error **shall** surface as toasts.
- **AC-31:** The AgentEditor **shall** gain an `evals` tab (key in the TABS list so the
  `?tab=` allowlist stays derived) showing metric tiles for the latest batch with deltas vs
  the previous one, and the case list with expectation badge, last-run status, and delete;
  "Run all evals" **shall** be disabled when the set is empty.
- **AC-32:** The sidebar **shall** gain an "Eval Dashboard" item (nav key `eval`, `/evals`,
  shortcut `g e`); each agent row links to `/agents/:id?tab=evals`.
- **AC-33:** All new UI strings **shall** go through `next-intl` message catalogues
  (`messages/en/eval.json`, `messages/en/prReview.json`) — no hardcoded user-facing text.

## Edge cases explicitly covered

Undecided finding (AC-3) · re-decided finding (AC-4) · duplicate create (AC-5) · summary
review without an agent (AC-6) · missing stored patch (AC-7) · cross-workspace access
(AC-11) · empty case set (AC-16) · malformed expectation (AC-24) · unparseable frozen diff
(AC-25) · unknown cost (AC-26) · pre-pipeline `eval_runs` rows without a batch stamp
(AC-27) · zero-`must_find` and zero-findings batches (AC-21/22/23 degenerate to 1.0).

## Verification

- `server/test/evals-scoring.test.ts` — AC-19..27 (scoring, degenerate batches, batch
  grouping), AC-4 (`decisionOf`), AC-8/9 (fragment + slug), AC-24 (parse round-trip).
- `client .../EvalsTab/EvalsTab.test.tsx` — AC-28, AC-31.
- `client .../EvalDashboardView/EvalDashboardView.test.tsx` — AC-32 (metrics, click-through).
- `client .../FindingCard/FindingCard.test.tsx` — AC-30 (disabled/enabled/absent states).
- Suites at ship time: server 389/389, client 381/381, both `typecheck` clean.

## Amendments — 2026-08-24 (second delivery wave)

The following shipped after the original retro-spec; each supersedes the
corresponding Non-goal above.

- **Manual case authoring UI** (was a Non-goal): the AgentEditor Evals tab now
  has "+ New case" and per-case ✎ Edit opening the CaseEditorModal — Name;
  Input tabs (Diff with a syntax-coloured Preview ↔ Edit toggle · PR meta
  title/body stored in `input_meta.pr_meta` and injected into the run's task
  line); Expected output as an editable JSON panel with a live valid-JSON badge,
  a "+ Finding skeleton" template button, and structured fields (expectation
  type select · file · start–end line range) that patch the same JSON; a
  Run-on-save toggle; Cancel / Run case / Save. Manually created cases live in
  the same set and run through the same routes (`POST /agents/:id/eval-cases`,
  `PUT /eval-cases/:id`).
- **Single-case runs**: `POST /eval-cases/:id/run` executes one case and stamps
  `scope:'case'` in `actual_output`; such runs update the case's last-run status
  but are EXCLUDED from the comparable batch history and the dashboard
  (`groupRunsIntoBatches` skips them). Full-set runs stamp `scope:'set'`.
- **Metric trend chart** ("CI as a trend"): the Evals tab renders
  recall/precision/citation_accuracy across ALL full-set batches
  (chronological; point = run) with a hover tooltip showing prompt version,
  ran-at, cost, and passed/total — rendered when ≥ 2 batches exist
  (`EvalsTab/_components/TrendChart`, recharts). Series colors follow the
  entities used everywhere else (recall=accent, precision=ok, citation=warn); a
  legend row names each series.
- **Per-case ▶ Play** in the cases list runs that single case with a pass/fail
  toast.

Related deliveries recorded elsewhere: the harness-side eval for the
L02-authored `onion-architecture` skill lives in
`evals/skills/onion-architecture/` (4 fixture-based cases, patternMatch
grounding first on the factual case); the deterministic commit test-gate hook in
`.claude/hooks/test-gate.sh` (+ README with caught-cases log); mutation testing
via Stryker on `server/src/modules/evals/scoring.ts`
(`server/stryker.conf.json`; killing test added for the per_trace survivors).

- **Seeded case editor from FindingCard** (2026-08-24, later wave): "Turn into
  eval case" no longer creates instantly — it fetches
  `GET /findings/:id/eval-case-seed` (same derivation as the one-click create:
  decision → expectation type, frozen diff fragment, PR title/body as pr_meta;
  400 while undecided) and opens the shared `CaseEditorModal`
  (`client/src/components/eval-case-editor/`) PREFILLED, with a
  POSITIVE/NEGATIVE CASE banner and an "Actual output — never run yet" panel;
  saving goes through the normal manual-create route carrying
  `source_finding_id` provenance. A finding that already has a case opens the
  editor anyway with a duplicate hint toast (`existing_case_id`).

- **Skill-owned eval sets** (2026-08-24, third wave): the given `owner_kind:
  'skill'` is now live. SkillDetail gains an **Evals** tab (cases list with
  MUST FIND / MUST NOT FLAG badges, per-case ▶/✎/🗑, "+ New eval case" via the
  shared CaseEditorModal, "Run all evals"). Routes: `GET/POST
  /skills/:id/eval-cases`, `GET/POST /skills/:id/eval-runs`. A skill run is a
  **with-vs-without benchmark**: every case executes twice through a
  deterministic carrier agent (first enabled agent by name) — once with ONLY
  this skill injected, once with none. Primary metrics = the with-skill pass;
  the baseline aggregate is stamped as `batch_baseline` (plus per-case
  `baseline.pass`) so the tab shows "With skill X% / Without skill Y%" — the
  skill's measured lift. For skill batches the comparable version axis is the
  SKILL's version (`agent_version` carries it; `skill_id` + carrier
  `agent_id` are stamped). Contracts: `EvalBatch.skill_id`/`baseline`,
  `EvalCaseLastRun.matched`/`baseline_pass`, `EvalCaseSummary.owner_kind`.
