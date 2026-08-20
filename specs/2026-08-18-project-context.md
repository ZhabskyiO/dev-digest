# Spec: Project Context (Project Context Folder)   |   Spec ID: SPEC-2026-08-18-project-context   |   Status: draft
Supersedes: none

## Problem & why

A reviewing agent today sees the diff, the agent's system prompt, its skills, memory, and
repo-intel derived structure. It does **not** see the project's own written intent: the PRD,
the security baseline, the retention policy, the postmortem that explains why a limit is 60
and not 600. Reviewers therefore get findings that are technically correct and
organisationally wrong — a change is flagged as unusual when a spec says it is mandated, or
a real violation of a written rule passes unnoticed because the rule only exists in
`specs/security-baseline.md`.

The repositories DevDigest reviews already carry that knowledge as markdown under `specs/`,
`docs/`, and `insights/`. Nothing reads it.

The engine side of this is already built and unused: `reviewer-core`'s `assemblePrompt`
(`reviewer-core/src/prompt.ts`) has a `specs?: string[]` slot that renders a
`## Project context` section with every entry wrapped in `<untrusted source="spec-N">`, and
records the rendered block in `PromptAssembly.specs`. `RunTrace.specs_read`
(`@devdigest/shared` contracts, `trace.ts`) exists, and the client Run Trace drawer already
renders both. The server never populates either — `run-executor.ts` writes `specs_read: []`
at two sites. This feature builds the missing producer: discover the documents, let a human
attach them, price them in tokens before the run, inject them at run time, and show exactly
what was injected.

Selecting documents **automatically** from the PR's content is deliberately deferred (see
Non-goals) — the manual path has to exist and be trustworthy first, and it is what makes an
automatic selector auditable later.

## Goals / Non-goals

- **Goal:** Discover every markdown document under a repo's configured context roots and
  present them, per repo, with type, size, and a token estimate.
- **Goal:** Let a user attach documents to an **agent** (a `Context` tab in the agent editor)
  and to a **skill** (a `Project context to use` section), with an explicit, reorderable order.
- **Goal:** Show the token cost of an attachment set *before* a run, so the prompt budget
  impact is a decision, not a surprise.
- **Goal:** At run time, read the attached files fresh from the repo clone and inject their
  text as **untrusted data** into the existing `## Project context` prompt slot.
- **Goal:** Make the injection fully auditable — the trace lists which documents were read,
  their token cost, and the Prompt Assembly panel exposes the full injected text.
- **Goal:** Store **paths, never text**, in the attachment metadata.
- **Goal:** Detect when an attached document has changed since it was attached, show that drift
  to the user with an explicit confirm action, and make an unconfirmed change visible on any
  run that used it.
- **Goal:** Show the attachment total **against the configured budget**, so an over-budget
  selection is visible while configuring rather than discovered in a trace after the fact.

- **Non-goal:** Automatic selection of relevant documents from the PR's content. This is a
  separate follow-up feature; nothing here may pre-empt its design beyond leaving the
  attachment set a plain ordered list.
- **Non-goal:** Chunking, embedding, or a per-document "coverage" score. Screenshot 1 shows
  `Indexed: 12 files · 1,240 chunks` and a `78 COVERAGE` ring; both belong to the automatic
  selector and are explicitly excluded here.
- **Non-goal:** Creating, editing, uploading, renaming, or deleting markdown inside the repo
  clone. Screenshot 1's `+` / new-folder / upload actions and the `Edit` half of the
  `Preview | Edit` toggle are **out of scope** — the clone is a git working tree the review
  pipeline reads, and write semantics (commit, push, dirty tree, conflicts) are a feature of
  their own. Preview is read-only; the `Edit` affordance must be absent or visibly disabled.
  Confirming a drifted document (AC-37) writes only DevDigest's own attachment metadata — it
  never writes to the clone, so it does not breach this boundary.
- **Non-goal:** Re-scoping agents or skills to a repository. They stay workspace-scoped; the
  attachment record carries the repository dimension instead (see AC-19).
- **Non-goal:** Reading documents from anywhere other than the target repository's clone —
  no URLs, no uploads, no DevDigest's own `specs/`.
- **Non-goal:** Any change to `reviewer-core`. Its `specs` slot, `wrapUntrusted`, and
  `INJECTION_GUARD` are consumed as they are.

## User stories

1. As a reviewer configuring a repo, I want to browse every markdown document DevDigest can
   see in my project, grouped by type, so that I know what context is available to attach.
2. As a reviewer, I want to open a document and read its rendered content inside DevDigest,
   so that I can confirm it says what I think before I attach it.
3. As an agent author, I want to tick documents on a `Context` tab of the agent editor, so
   that this agent reviews with my project's written rules in hand.
4. As a skill author, I want to attach documents to a skill, so that every agent using that
   skill inherits the same context without re-attaching it.
5. As an agent author, I want to see the token cost of each document and the total for the
   attachment set measured against the budget, so that I can trade context against budget
   before running instead of finding out from a trace afterwards.
6. As an agent author, I want to control the order of attached documents, so that the most
   important one is read first.
7. As a reviewer reading a run, I want the trace to name every document that was read and
   let me open its full injected text, so that I can explain or dispute a finding.
8. As an operator, I want an attached document that has been moved or deleted in the repo to
   degrade the run rather than break it, so that a doc rename never takes reviews down.
9. As a security owner, I want project documents treated as untrusted data, so that a spec
   file cannot instruct the reviewing model to stand down.
10. As an agent author, I want to be told when an attached document has changed since I
    attached it and to review that change before accepting it, so that the rules my agent
    reviews against never change behind my back.

## Acceptance criteria (EARS)

> AC ids are allocation-ordered, not positional: AC-34..AC-44 were added in a later revision
> and sit in the section they belong to rather than at the end of the document. Every id is
> unique and the range 1..44 is contiguous.

### Discovery

- **AC-1:** WHEN a project-context document list is requested for a repository, the system
  **shall** return every file with a `.md` extension that lies under a directory segment
  matching a configured context root (`specs`, `docs`, `insights`) at any depth within that
  repository's clone.
  _(observable: a fixture clone containing `specs/a.md`, `docs/nested/b.md`,
  `pkg/insights/c.md`, `README.md`, `specs/d.txt` yields exactly a.md, b.md, c.md)_

- **AC-34:** In addition to the directory roots of AC-1, the system **shall** discover files
  whose *filename* matches a configured conventional-document allowlist (default: `insights.md`,
  case-insensitive) at any depth, and **shall** assign them the document type of the convention
  they matched.
  _(observable: a fixture clone with `insights.md` at the root and `server/insights.md` yields
  both, typed `insights`. This criterion exists because measurement found the directory-only
  rule misses almost all of them: across the four checkouts available locally, five of the six
  insights documents — 39 921 of their 47 142 characters, including the single largest document
  in the corpus at 23 421 characters — live as a FILE named `insights.md` at a module root, not
  inside an `insights/` directory. That is this project's own documented convention. A
  directory-only reader finds exactly one of the six.)_

- **AC-2:** The system **shall** exclude from discovery any path containing a `clones`,
  `node_modules`, `.git`, `dist`, or `.next` directory segment.
  _(observable: a fixture clone with `clones/other-repo/specs/x.md` and
  `node_modules/pkg/docs/y.md` returns neither; this is not cosmetic — an imported repo may
  itself be a checkout of DevDigest, whose `clones/` holds full copies of every other
  imported repo, so omitting this exclusion multiplies the document list by the number of
  imported repos and can inject an unrelated project's specs)_

- **AC-3:** IF a discovered entry resolves — after symlink resolution — to a location outside
  the repository's clone root, THEN the system **shall** drop it from the list.
  _(observable: a symlink inside the clone pointing at `/etc` or at a sibling clone does not
  appear in the returned list; mirrors the resolve-and-recheck rule already applied in
  `server/src/modules/reviews/intent/docs.ts`)_

- **AC-4:** IF the repository has no clone on disk, THEN the system **shall** return an empty
  document list together with a machine-readable `not_cloned` reason, and **shall not** return
  an error status.
  _(observable: a repo row whose clone path is null returns 200 with zero documents and the
  reason field set)_

- **AC-5:** The system **shall** cap discovery at a configured maximum document count and a
  configured maximum per-file size, and **shall** report how many entries were omitted by each
  cap.
  _(observable: a fixture clone exceeding both caps returns the capped list plus non-zero
  omission counters)_

- **AC-6:** WHEN a user triggers a rescan for a repository, the system **shall** re-walk the
  clone and return a list reflecting files added, removed, or modified since the previous
  scan.
  _(observable: adding a file to the fixture clone and rescanning grows the list by one
  without a server restart)_

- **AC-43:** IF a repository's scan finds no documents because none of the configured roots
  exist, THEN the system **shall** render an empty state that names the roots it scanned and
  the conventional filenames it looks for.
  _(observable: the Project Context page for a repo with no matching files shows copy to the
  effect of: **"No project context found. DevDigest reads Markdown from `specs/`, `docs/` and
  `insights/` folders at any depth in this repository, plus any file named `insights.md`. Add
  one of these to `<owner>/<repo>` and rescan."** — the roots named must be the configured
  ones, not hardcoded, so the copy stays true if configuration changes. Distinct from AC-4's
  `not_cloned` state, which is about the clone being absent rather than the documents.)_

### Document metadata and token accounting

- **AC-7:** The system **shall** expose, for every discovered document, its clone-relative
  path, its document type derived from the matched root segment (`specs` | `docs` |
  `insights`), its byte size, a content hash, and an estimated token count.
  _(observable: each item in the list response carries all five fields, and `type` for
  `pkg/insights/c.md` is `insights`)_

- **AC-8:** The system **shall** compute a document's token estimate from its full raw body
  using the workspace's configured token counter, and **shall** reuse a cached estimate while
  the document's content hash is unchanged.
  _(observable: two consecutive list calls over an unmodified clone invoke the token counter
  for zero documents on the second call; editing one file re-counts exactly that one)_

- **AC-9:** WHERE the exact tokenizer of the target model is not available, the system
  **shall** present every token figure as an approximation (a `≈` marker or equivalent) rather
  than an exact count.
  _(observable: rendered token labels in the document list, the attachment rows, and the
  attachment total all carry the approximation marker, as in screenshots 3 and 4)_

- **AC-10:** WHEN a user opens a document preview, the system **shall** return the document's
  markdown body up to a configured preview cap, and the client **shall** render it as
  formatted markdown, read-only.
  _(observable: the preview panel of screenshot 4 shows headings, lists, and inline code from
  `specs/security-baseline.md`; no editable control is present)_

- **AC-11:** The system **shall** report, per document, how many agents currently have it
  attached.
  _(observable: the `Used by 2 agents` label in screenshot 4 equals the number of distinct
  agents whose effective attachment set contains that path)_

### Attaching documents

- **AC-12:** WHEN a user toggles a document on in an agent's `Context` tab, the system
  **shall** persist an attachment recording the repository and the clone-relative path, and
  **shall not** persist the document's text.
  _(observable: after attaching, the stored attachment row contains a repo reference and a
  path and no body column; editing the file on disk afterwards changes nothing stored)_

- **AC-13:** WHEN a user toggles a document on in a skill's `Project context to use` section,
  the system **shall** persist an equivalent attachment against that skill.
  _(observable: screenshot 2's checked `public-api.md` survives a reload and appears in the
  skill's attachment list)_

- **AC-14:** The system **shall** persist an explicit order for each attachment set, and
  **shall** treat that order as the order in which the documents are rendered into the prompt.
  _(observable: reordering two attachments and re-running produces a `## Project context`
  block whose `spec-0` is the newly-first document)_

- **AC-15:** Attaching a document that is already attached to the same agent or skill
  **shall** leave the attachment set unchanged.
  _(observable: issuing the same attach twice yields one attachment and no duplicate in the
  prompt)_

- **AC-16:** The system **shall** compute an agent's *effective* context set as its own
  attachments followed by the attachments of every skill that is both linked to that agent and
  globally enabled, de-duplicated by (repository, path), keeping the first occurrence's
  position.
  _(observable: an agent with `security-baseline.md` attached directly and a linked enabled
  skill attaching `security-baseline.md` + `public-api.md` yields exactly two documents, with
  `security-baseline.md` first; disabling the skill drops `public-api.md`. The two-gate rule
  — linked AND globally enabled — matches how skill bodies already resolve in
  `server/src/modules/reviews/prompt-context.ts`)_

- **AC-17:** The system **shall** display the summed token estimate of an agent's effective
  context set alongside the attachment list.
  _(observable: screenshot 3's `≈ 317 tokens` equals the sum of the two checked documents'
  estimates)_

- **AC-40:** The system **shall** display the effective set's token total against the
  configured project-context budget, and WHILE that total exceeds the budget it **shall**
  present an explicit over-budget state naming which documents would not be injected.
  _(observable: screenshot 3's `≈ 317 tokens` gains a ceiling — e.g. `≈ 317 / 12 000 tokens`;
  attaching documents past the budget switches the total into an over-budget state that lists
  the tail documents AC-23 would drop, in the same order AC-23 would drop them)_

- **AC-41:** The over-budget state **shall not** prevent attaching further documents, saving
  the configuration, or starting a run.
  _(observable: with an over-budget selection, attach/save/run all succeed and the run degrades
  per AC-23 — the warning is advisory; the run-time budget rule remains the enforcement point)_

- **AC-18:** WHEN a user types into the document filter of an attachment list, the system
  **shall** narrow the visible rows to those whose path or filename contains the query, without
  altering the attachment set.
  _(observable: typing `sec` in screenshot 3's `Filter documents…` leaves `security-baseline.md`
  visible and previously-checked rows still checked when the filter is cleared)_

### Document drift

- **AC-35:** WHEN a document is attached, the system **shall** record, alongside the path, the
  document's content hash, its size, and the clone's current commit revision at that moment.
  _(observable: the stored attachment carries a hash matching the file's content at attach time
  and the revision the clone was on; it still stores no body, per AC-12. The revision is what
  makes AC-38's comparison possible without storing text — the clone is a git working tree, so
  the attached-time content is recoverable from the repository itself)_

- **AC-36:** IF a discovery or rescan finds that an attached document's current content hash
  differs from the hash recorded at attach time, THEN the system **shall** mark that attachment
  as changed-since-attached wherever it is listed.
  _(observable: editing an attached file in the fixture clone and rescanning shows a drift
  marker on that row in the agent's Context tab, the skill's context section, and the Project
  Context list; an unchanged file shows no marker)_

- **AC-37:** WHEN a user confirms a changed-since-attached document, the system **shall**
  update the recorded hash and size to the current content and clear the drift marker, and
  **shall not** modify the file in the clone.
  _(observable: confirming clears the marker; rescanning does not bring it back; the file's
  mtime and content on disk are unchanged)_

- **AC-38:** WHEN a user opens the drift detail for a changed-since-attached document, the
  system **shall** show the difference between the document as it was at the recorded revision
  and its current content; IF that revision is no longer resolvable in the clone, THEN the
  system **shall** show the current content together with an explicit note that the earlier
  version is unavailable, and **shall** still allow confirmation.
  _(observable: editing an attached file and opening the drift detail renders a line-level
  comparison; after a force-push or a re-clone that drops the recorded revision, the same
  detail renders the current content plus the unavailable note, and the confirm action still
  works — drift review degrades, it never blocks)_

### Versioning

- **AC-19:** IF an agent's attachment set is changed, THEN the system **shall** record the
  resulting ordered path list in that agent's immutable config snapshot and bump the agent's
  version.
  _(observable: attaching a document produces a new agent version whose snapshot contains the
  ordered attachment paths — the same treatment the ordered skill-id list already receives in
  the agent version config contract)_

### Versioning

- **AC-39:** WHEN a skill's attachment set changes, the system **shall** append a new immutable
  skill version snapshot carrying the ordered attachment list, and **shall** bump the skill's
  version.
  _(observable: attaching a document to a skill appends a `skill_versions` row for that skill
  with an incremented version. Today that table snapshots `(skill_id, version, body, label,
  created_at)` and a row is appended only when `body` changes; this criterion extends the
  snapshot to carry the attachment list as well — the same reproducibility argument that
  justifies snapshotting the body applies to the context attached alongside it)_

- **AC-42:** The system **shall** append a skill version snapshot when the skill's body changes,
  when its attachment set changes, or when both change, and **shall not** append one when
  neither changes.
  _(observable: editing only the body appends one version; changing only attachments appends
  one version; saving with no change to either appends none — preserving today's
  "snapshot only on real change" behaviour rather than versioning every save)_

### Run-time injection

- **AC-20:** WHEN a review run starts for an agent whose effective context set is non-empty,
  the system **shall** read each attached document's current content from the repository clone
  and supply the bodies, in persisted order, to the prompt's project-context slot.
  _(observable: a run against a fixture repo produces a user message containing
  `## Project context` followed by the attached documents' text in order)_

- **AC-21:** The system **shall** deliver project-context document bodies to the prompt as
  untrusted data, delimiter-wrapped, under the shared injection guard.
  _(observable: the assembled user message contains `<untrusted source="spec-0">` around the
  first document's body, and the system message contains the injection guard — both are
  existing `reviewer-core` behaviour that this feature must not bypass)_

- **AC-22:** IF an attached document is missing, unreadable, or resolves outside the clone
  root at run time, THEN the system **shall** omit that document, complete the run, and record
  the omission with its path and a reason in the run trace and the run log.
  _(observable: deleting an attached file from the fixture clone and re-running yields a
  completed run whose trace marks that path as missing and whose prompt omits it)_

- **AC-23:** IF the effective context set's estimated tokens exceed the configured
  project-context budget, THEN the system **shall** inject documents in order until the budget
  is reached, omit the remainder, and record each omitted path with an over-budget reason.
  _(observable: a set whose second document alone exceeds the budget injects only the first and
  records the second as dropped; the run still completes)_

- **AC-24:** The system **shall** truncate any single document's body to a configured
  per-document character cap before injection, and **shall** record that the document was
  truncated.
  _(observable: an attached 200 KB markdown file contributes at most the cap to the prompt and
  is marked truncated in the trace)_

- **AC-25:** IF an attached document belongs to a repository other than the one the run's pull
  request targets, THEN the system **shall** omit it and record it with a `wrong_repo` reason.
  _(observable: an agent with an attachment from repo A, run on a PR in repo B, injects
  nothing from A and says so in the trace; this exists because agents are workspace-scoped
  while documents are repository-scoped)_

- **AC-44:** WHEN a run reads an attached document, the system **shall** compare the content it
  just read against the hash recorded at attach time; IF they differ, THEN it **shall** inject
  the current content anyway and record the document in the run trace and in the Prompt Assembly
  project-context slot as changed-and-unconfirmed.
  _(observable: editing an attached file without confirming it, then running, yields a completed
  run whose prompt contains the NEW content and whose trace marks that document
  `changed_unconfirmed` — and this holds even when no rescan happened in between, because the
  comparison uses the content the run itself read rather than the last scan's result. A run must
  never block on user input, and a stale document is worse than a flagged one, so the live
  content wins and the drift is visible on the very run that used it. See Open questions: a hard
  block was considered and deliberately rejected)_

- **AC-26:** WHERE an agent's effective context set is empty, the assembled prompt **shall**
  be byte-identical to the prompt the same run produces today.
  _(observable: a golden-prompt comparison for an agent with no attachments shows no
  `## Project context` section and no other diff)_

- **AC-27:** Assembling project context **shall not** issue any model call.
  _(observable: a run with a non-empty context set makes the same number of LLM provider calls
  as the identical run with an empty one)_

- **AC-28:** The system **shall** apply the same project-context resolution and injection to
  the PR review path, the local (no-PR) review path, and the CI review path.
  _(observable: a local review and a PR review over the same agent and repo both contain the
  same `## Project context` section — the enrichment lives with the shared prompt-context
  builders, not inside one executor)_

### Trace and Prompt Assembly transparency

- **AC-29:** WHEN a run finishes, the system **shall** persist, for every document in the
  effective context set, its path, its token count, and its outcome (`injected`, `missing`,
  `dropped_over_budget`, `truncated`, `wrong_repo`, or `changed_unconfirmed`) in the run trace.
  _(observable: the persisted trace document for a run with one injected and one deleted
  document lists both with distinct outcomes; a run over a drifted document records
  `changed_unconfirmed` per AC-44)_

- **AC-30:** The run trace view **shall** list the documents read for the run in its
  configuration section.
  _(observable: screenshot 5's `Specs read  specs/security-baseline.md  specs/public-api.md`;
  the client already renders this field, which the server fills with an empty array today)_

- **AC-31:** The Prompt Assembly panel **shall** present the project-context block as a
  distinct, labelled slot marked untrusted, expandable to its full injected text and
  copyable.
  _(observable: screenshot 5's `Project context — attached specs (untrusted)` row expands to
  the complete text, including the `<untrusted>` delimiters the model actually saw)_

- **AC-32:** IF a run injected no project context, THEN the Prompt Assembly panel **shall**
  omit the project-context slot rather than render an empty one.
  _(observable: an old trace persisted before this feature, and a new run with no attachments,
  both render without the slot and without an error)_

- **AC-33:** The system **shall** read traces persisted before this feature without error.
  _(observable: a stored trace document lacking any project-context detail loads and renders;
  the trace is stored as a single JSON document that is cast rather than re-parsed on read, so
  absent keys are a real runtime value)_

## Edge cases

| Case | Expected behaviour | Coverage |
|---|---|---|
| Clone contains a nested `clones/` tree (imported repo is DevDigest itself) | excluded from discovery | AC-2 |
| Symlink inside the clone pointing outside it | dropped | AC-3 |
| Repo imported but not yet cloned | empty list + `not_cloned` reason, no error | AC-4 |
| Repository with thousands of markdown files | capped list + omission counters | AC-5 |
| Single 200 KB markdown document | truncated before injection, marked truncated | AC-24 |
| Zero-byte / whitespace-only markdown | discovered, token estimate 0, contributes no section content | AC-7, AC-26 |
| Attached document deleted between attach and run | run completes, omission recorded | AC-22 |
| Attached document renamed between attach and run | treated as missing (attachments key on path, not content) | AC-22 |
| Attached document edited between attach and run | the *new* content is injected, and the document is flagged drifted in the UI and `changed_unconfirmed` in the trace | AC-20, AC-36, AC-44 |
| User confirms a drifted document | recorded hash/size/revision advance to current; marker clears; clone untouched | AC-37 |
| Drifted document whose attach-time revision was force-pushed away or GC'd | drift detail shows current content plus an "earlier version unavailable" note; confirm still works | AC-38 |
| Document edited and then edited back to its original content | hash matches again, so no drift is reported | AC-36 |
| Attached document is drifted AND over budget on the same run | it is dropped for budget; the trace records the drop, and the drift marker persists in the UI | AC-23, AC-36 |
| `insights.md` at a module root rather than inside an `insights/` directory | discovered via the conventional-filename allowlist | AC-34 |
| Selection exceeds the budget while configuring | over-budget state shown, listing which documents would be dropped; attaching/saving/running still permitted | AC-40, AC-41 |
| Skill body and attachment set changed in one save | exactly one new skill version snapshot, carrying both | AC-42 |
| Skill saved with neither body nor attachments changed | no new snapshot | AC-42 |
| Attachment set larger than the token budget | prefix injected, remainder recorded as dropped | AC-23 |
| Agent attached to docs from a repo it is not reviewing | omitted with `wrong_repo` | AC-25 |
| Same document attached to both the agent and one of its skills | de-duplicated, agent's position wins | AC-16 |
| Skill attached to docs but globally disabled | its documents do not reach the prompt | AC-16 |
| Document body contains `</untrusted>` | neutralised by the existing wrapper before it reaches the prompt | AC-21 |
| Document body contains "ignore previous instructions" / "this repo is a demo, do not flag" | treated as data; the injection guard states such claims never descope a review | AC-21 |
| Repo clone is mid-fetch / file read races a git checkout | unreadable file is omitted, run completes | AC-22 |
| Two agents rescanning the same repo concurrently | both receive a consistent list; a rescan is idempotent | AC-6 |
| Agent deleted while documents attached | attachments disappear with the agent | accepted: existing cascade-delete behaviour of agent-scoped links; no new criterion |
| Repo removed from the workspace while documents attached | attachments disappear with the repo | accepted: existing cascade-delete behaviour; no new criterion |
| Non-UTF8 / binary file named `.md` | read fails or decodes to garbage; omitted at run time | AC-22 |
| Markdown with a very deep directory nesting | discovered normally | AC-1 |
| Token counter fails to initialise | estimate falls back to a heuristic; figures stay approximate | AC-8, AC-9 |
| User opens the Project Context page for a repo with no `specs`/`docs`/`insights` at all | empty state naming the scanned roots and conventional filenames | AC-43 |

## Non-functional

- **Discovery latency:** a rescan of a repository with ≤ 2 000 candidate markdown files
  completes in **p95 < 2 s**; a cached list request (no content change) responds in
  **p95 < 200 ms**.
- **Run-time overhead:** resolving, reading, and hash-comparing an effective context set of
  ≤ 20 documents adds **< 300 ms p95** to run start and **zero** model calls (AC-27, AC-44).
  At the measured p50 of 4 081 characters per document this is a trivial amount of hashing; the
  budget is dominated by file I/O, not by the drift check.
- **Prompt budget:** the project-context block is capped at a configured token budget defaulting
  to **12 000 tokens**, and any single document at a configured cap defaulting to **16 000
  characters (≈ 4 000 tokens)**. Both are configuration, not constants baked into behaviour.
  These two numbers are measured, not assumed — see *Measured basis for the defaults* below.
- **Path safety:** every read is resolved and re-checked against the clone root *after*
  symlink resolution (AC-3, AC-22). Path containment via string prefix alone is insufficient.
- **Rate limiting:** rescan is a filesystem walk over user-controlled repositories — limit it
  to **6 requests/minute per repository**.
- **Untrusted-content handling:** see *Untrusted inputs*; the grounding gate and the injection
  guard remain mandatory and are never bypassed by this feature.
- **Accessibility:** the attachment list is a keyboard-operable checkbox list meeting **WCAG
  2.1 AA** — every row reachable by Tab, toggleable by Space, with an accessible name that
  includes the document path and its token estimate; reordering is achievable without a
  pointer; token and status colour cues are never the sole carrier of meaning.
- **Internationalisation:** all new user-facing strings are message-catalogue keys; document
  paths and bodies are data and are not translated.
- **Configuration:** the context roots are configuration, defaulting to `specs`, `docs`, and
  `insights`. Note for whoever writes that configuration down: a literal glob containing the
  two-character sequence that closes a block comment must never appear inside a `/** … */`
  comment in this codebase — it truncates the comment and produces a cascade of unrelated
  parser errors far below the real cause.

## Measured basis for the defaults

Measured on 2026-08-18 over the repositories available locally: the three imported target repos
under the server's clone directory (`dev-digest`, `nodejs-server-test`,
`zhabskyi-components-mui`) plus the DevDigest working tree. Read-only. Token counts are
`cl100k_base`, the encoding the existing token counter already uses.

**Two corpora, because they answer different questions.** The *reader* corpus is what AC-1 +
AC-34 would actually discover — it is small (13 files under directory roots alone), so it is
only trustworthy for **counts**. The *broad* corpus is every Markdown file in the same
checkouts excluding `clones`, `node_modules`, `.git`, `dist`, `.next` — n = 301, which is what
makes the **size distribution** defensible.

| Corpus | Files | chars p50 | p75 | p90 | p95 | p99 | max | tokens p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Broad Markdown (n = 301) | 301 | 4 081 | 7 759 | 10 965 | 13 705 | 21 680 | 32 923 | 1 025 | 2 669 | 3 498 | 5 345 | 7 714 |
| Reader roots only (n = 13) | 13 | 5 484 | 6 910 | 7 151 | 32 923 | — | 32 923 | 1 253 | 1 846 | 7 714 | — | 7 714 |

Cumulative share of the broad corpus at or below a character size:
**≤ 4 000 → 47.8 %** · **≤ 8 000 → 77.7 %** · **≤ 12 000 → 92.4 %** · **≤ 16 000 → 96.7 %** ·
**≤ 32 000 → 99.7 %**.

**Measured chars-per-token for Markdown = 4.01** overall (per-file p10 3.76, p50 4.03, p90
4.27). This is a useful secondary result: the existing `ceil(chars / 4)` fallback is accurate
to within roughly 7 % on this content, so AC-8's fallback path is not a cliff.

**Per-document cap → 16 000 characters.** The originally guessed 8 000 covers only **77.7 %** of
real documents, i.e. it would silently truncate about one document in four — unacceptable when
the entire purpose is that the model reads the whole rule. 16 000 characters covers **96.7 %**
of the corpus untruncated (≈ 4 000 tokens at the measured ratio, which sits between the token
p95 of 3 498 and p99 of 5 345). Truncation becomes an outlier event rather than routine.

**Budget → 12 000 tokens.** Anchored on realistic sets rather than worst cases:

- a set of 11–12 median-sized documents (p50 = 1 025 tokens) fits — comfortably more than the
  seven documents the design surfaces in screenshots 2 and 3;
- seven p90-sized documents (2 669 each ≈ 18 700 tokens) do **not** fit, so the over-budget
  state of AC-40 is reachable in practice rather than dead UI;
- three documents at the per-document cap saturate it exactly (3 × 4 000), which keeps the two
  limits coherent;
- for scale, screenshot 5 shows a real run at 15 k input tokens, so a saturated project-context
  block is a deliberate, visible doubling of the prompt — not something that should happen by
  accident, which is precisely why AC-40 puts the ceiling on screen.

**Caveat, stated honestly:** the single largest file in both corpora (32 923 characters) is an
earlier draft of *this* spec, so the `max` column is mildly self-referential; the percentiles
that the defaults actually rest on (p50–p95) are not affected by it. More importantly, only
three imported repositories were available, and none of the
non-DevDigest ones contain any document under the reader roots at all (`nodejs-server-test` and
`zhabskyi-components-mui` return zero). The size distribution is therefore trustworthy; the
*per-repository document count* is not, and both defaults should be revisited once real
customer repositories are indexed. That is what makes them configuration rather than constants.

## Cross-module interactions

**Modules involved:** `client` (Project Context page, agent `Context` tab, skill
`Project context to use` section, Run Trace drawer), `server` (document reader over the repo
clone, attachment storage, run-time resolution, trace persistence), `@devdigest/shared`
(document, attachment, and trace contract shapes — canonical copy in
`server/src/vendor/shared`, mirrored into `client/src/vendor/shared`), and `reviewer-core`
(**consumer only**, unchanged).

**What crosses each boundary:**

- client → server: repository id, filter query, attachment mutations (agent/skill id +
  ordered document references), and drift confirmations (AC-37).
- server → client: document descriptors (path, type, size, hash, token estimate, usage
  count, drift state), preview bodies, drift comparisons, effective context sets with totals
  and the budget they are measured against.
- server → git working tree (read-only): the current file content, and the file as of an
  attachment's recorded revision, to build the drift comparison (AC-38). The clone is never
  written to.
- server → reviewer-core: an ordered array of document *bodies* only. `reviewer-core` receives
  no paths, no repo identity, and no filesystem access — its purity rule is unaffected.
- server → client (trace): the ordered list of documents read plus the rendered
  project-context block, both inside the single persisted trace document.

**Failure contract:** every step is best-effort and degrades rather than fails. An unavailable
clone yields an empty list (AC-4); an unreadable, missing, oversized, or wrong-repo document
is omitted with a recorded reason (AC-22, AC-23, AC-24, AC-25); a token-counter failure falls
back to a heuristic (AC-8); an unresolvable attach-time revision degrades the drift comparison
without blocking confirmation (AC-38); an unconfirmed change is recorded, never blocking
(AC-44). No project-context failure may fail a review run — the same rule the existing
repo-intel enrichment already follows.

```mermaid
sequenceDiagram
    participant U as User (client)
    participant S as server
    participant FS as repo clone (filesystem)
    participant RC as reviewer-core
    participant LLM as LLM provider

    Note over U,S: Configure (no model involved)
    U->>S: list project-context documents (repo)
    S->>FS: walk context roots, skip clones/node_modules/.git
    FS-->>S: markdown paths + bodies
    S->>S: hash, type, token estimate (cached)
    S-->>U: document descriptors + token estimates
    U->>S: attach doc to agent / skill (repo + path, ordered)
    S->>S: record hash + size + revision at attach
    S-->>U: effective set + total tokens / budget

    Note over U,S: Drift (no model involved)
    S->>S: rescan: current hash != attached hash
    S-->>U: mark changed-since-attached
    U->>S: view what changed
    S->>FS: read file at recorded revision
    FS-->>S: earlier content (or unavailable)
    S-->>U: comparison
    U->>S: confirm
    S->>S: advance stored hash/size/revision

    Note over U,LLM: Run
    U->>S: run review
    S->>S: resolve effective set (agent + enabled linked skills)
    S->>FS: read attached files fresh
    alt file missing / outside clone / over budget
        FS--xS: unavailable
        S->>S: omit + record reason
    else readable
        FS-->>S: body
    end
    S->>RC: assemblePrompt(specs: bodies[], diff, …)
    RC->>RC: wrapUntrusted per doc + injection guard
    RC->>LLM: single structured call (no extra call for context)
    LLM-->>RC: findings
    RC->>RC: groundFindings (mandatory gate)
    RC-->>S: review + prompt assembly record
    S->>S: persist trace (documents read + rendered block)
    S-->>U: trace: specs read, Prompt Assembly slot
```

## Contracts

Shapes only — field names are indicative, not prescriptive.

**Project-context document (server → client, list and preview):**
- `path` — clone-relative, required
- `type` — one of `specs` | `docs` | `insights`, required
- `size_bytes` — integer, required
- `content_hash` — string, required
- `tokens` — integer, required, an estimate (AC-9)
- `used_by_agents` — integer, required
- `body` — string, present on preview only, capped
- `drift` — optional; present when this document is attached somewhere and its current hash
  differs from an attach-time hash (AC-36)

**Document list response:**
- `documents` — array of the above, required (possibly empty)
- `reason` — optional; `not_cloned` when the repository has no clone (AC-4)
- `omitted` — optional counters for entries dropped by the count / size caps (AC-5)
- `scanned_at` — timestamp of the walk that produced this list

**Attachment (client → server, and stored):**
- owner — exactly one of an agent reference or a skill reference, required
- `repo_id` — required (documents are repository-scoped; agents and skills are not)
- `path` — clone-relative, required
- `order` — integer, required; defines prompt order (AC-14)
- `attached_hash` — content hash at attach time, required (AC-35)
- `attached_size` — integer, required (AC-35)
- `attached_revision` — the clone's commit revision at attach time, required; enables the drift
  comparison without storing text (AC-35, AC-38)
- **no body field** — text is never stored (AC-12)

**Drift comparison (server → client):**
- `path`, `attached_revision` — required
- `previous` — the document at the recorded revision; absent when the revision is no longer
  resolvable (AC-38)
- `current` — the document as it is now, required
- `previous_unavailable` — boolean, set when `previous` is absent

**Effective context set (server → client, per agent):**
- `documents` — ordered array of `{ repo_id, path, type, tokens, source, drift }` where `source`
  distinguishes a direct attachment from one inherited via a skill (AC-16) and `drift` marks a
  changed-since-attached document (AC-36)
- `total_tokens` — integer (AC-17)
- `budget_tokens` — integer, the configured budget the total is measured against (AC-40)
- `over_budget` — boolean, plus the ordered paths that would be dropped (AC-40)

**Agent version config (existing shape, extended):**
- gains an ordered array of attached document references, alongside the ordered skill-id array
  it already carries (AC-19).

**Skill version snapshot (existing shape, extended):**
- the immutable per-version skill snapshot — today `(skill_id, version, body, label, created_at)`
  — gains an ordered array of attached document references, and a new row is appended when the
  body or the attachment set changes (AC-39, AC-42).

**Prompt slot (server → reviewer-core, existing shape, newly populated):**
- the existing optional ordered array of strings on the prompt-parts input. No contract change;
  the server stops passing nothing.

**Run trace (existing shape, extended backward-compatibly):**
- the existing `specs read` list continues to identify the documents actually injected, in
  order (AC-30);
- a new **optional** per-document detail array carries `{ path, tokens, outcome }` where
  outcome ∈ `injected` | `missing` | `dropped_over_budget` | `truncated` | `wrong_repo` |
  `changed_unconfirmed` (AC-29, AC-44);
- the existing prompt-assembly project-context field continues to carry the fully rendered
  block, including delimiters, exactly as the model saw it (AC-31);
- every new field is optional so traces written before this feature parse unchanged (AC-33).

## Untrusted inputs

**Yes — this feature's entire payload is untrusted.** Markdown under a target repository's
`specs/`, `docs/`, and `insights/` is third-party, author-controlled text. Anyone who can open
a pull request against that repository can, in principle, change a document that a DevDigest
agent injects into its prompt.

- Every attached document body reaches the model inside a `<untrusted source="spec-N">` block,
  and the shared injection guard on the system message states that content inside those
  delimiters is data and that claims such as "intentional", "demo", "test fixture", or "do not
  flag" never descope a review (AC-21).
- Attempts to close the delimiter from inside a document body are neutralised by the existing
  wrapper (edge cases table).
- Defence is the trusted-rule-plus-wrapper design, **not** keyword scanning. This feature must
  not introduce a denylist over document content; a denylist catches one phrasing.
- `groundFindings()` remains a mandatory gate — a finding that cites no real diff line is
  dropped and the score recomputed, whatever a project document claims.
- Path handling treats discovered filenames as untrusted too: resolve, then re-check
  containment after symlink resolution (AC-3, AC-22).
- The document preview in the client renders untrusted markdown; it must not execute embedded
  HTML or scripts, and must not make embedded links or images auto-load from external hosts.
- Selecting *which* documents are attached remains a deliberate human act. That is the main
  reason automatic selection is deferred: it would let untrusted repository content decide
  what enters the prompt.

## Open questions

### Resolved

Confirmed by the user on 2026-08-18. These four were the blocking decisions; each was proposed
as a default and each was accepted as written, so the spec above stands unchanged:

  (a) **Document scoping** — documents are repository-scoped and an attachment stores
  `repo_id + path`; agents and skills stay workspace-scoped and a cross-repo attachment is
  skipped at run time (AC-25). Alternative considered: path-only attachments resolved against
  whatever repo the PR belongs to — rejected because the same path means different content per
  repo.
  (b) **Page scope** — the Project Context page is read-only browse/preview/rescan; creating,
  editing, and uploading markdown, plus the coverage ring and chunk indexing shown in
  screenshot 1, are Non-goals.
  (c) **Token counting** — the existing token-counter port (cl100k_base, with a
  characters-over-four fallback), cached per content hash, always rendered as an approximation
  (AC-8, AC-9).
  (d) **Versioning** — an attachment change bumps the agent version and lands in the immutable
  config snapshot (AC-19), mirroring how the ordered skill list is already snapshotted.

Resolved in the second round, 2026-08-18:

  (e) **Skill attachment versioning** — confirmed: a skill's attachment set is version-
  snapshotted like its body. The existing per-version skill snapshot is extended to carry the
  ordered attachment list, and a new snapshot is appended when the body OR the attachment set
  changes (AC-39, AC-42).
  (f) **Budget defaults** — no longer a guess. Measured over the locally available repositories
  and derived in *Measured basis for the defaults*: **12 000 tokens** for the project-context
  budget and **16 000 characters (≈ 4 000 tokens)** per document, covering 96.7 % of measured
  documents untruncated. The earlier 8 000-character guess would have truncated ~22 % of real
  documents.
  (g) **Budget warning at configuration time** — approved. The total renders against the budget
  and enters an explicit over-budget state naming the documents that would be dropped (AC-40),
  in addition to — not instead of — the trace record; it never blocks attaching, saving, or
  running (AC-41), so AC-23's graceful degradation still governs the run.
  (h) **`.devdigest/` was illustrative** — confirmed. Discovery scans `specs`/`docs`/`insights`
  directory segments at any depth (AC-1), which also matches `.devdigest/specs/`. No behaviour
  change.
  (i) **Document drift** — the user must be told before a changed document is relied on.
  Specified as: record hash, size, and clone revision at attach time (AC-35); mark drifted
  attachments on rescan (AC-36); let the user view the change and confirm, which advances the
  stored hash (AC-37, AC-38); and, because a run cannot block on user input, still inject the
  live content while recording it as `changed_unconfirmed` in both the trace and Prompt
  Assembly (AC-44). A **hard block** — refusing to inject an unconfirmed change — was considered
  and rejected: it would let an ordinary documentation edit silently strip context from every
  review until someone noticed, which is a worse and much quieter failure than a flagged run.
  This is a judgement call and is cheap to invert: flip AC-44's response clause and the rest of
  the drift machinery is unchanged.
  (j) **Empty-state copy** — closed with concrete copy in AC-43, which names the configured
  roots and the conventional filenames rather than hardcoding them.

### Still open

- [NEEDS CLARIFICATION: **Discovered by measurement, needs a decision.** Five of the six
  `insights` documents in the local corpus — including the single largest document at 23 421
  characters — live as a FILE named `insights.md` at a module root, not inside an `insights/`
  directory, which is this project's own documented convention. AC-34 therefore adds a
  configurable conventional-**filename** allowlist (default `insights.md`) on top of the
  directory roots. Confirm this is wanted, and whether the allowlist should also cover
  `README.md`, `RFC*.md` and `ADR*.md` — the existing document-reference reader in the intent
  pipeline already treats exactly those as project documentation, so there is a precedent
  pulling in that direction and a scope argument pulling against it.]
- [NEEDS CLARIFICATION: The measured defaults rest on a thin corpus for *counts* — only three
  imported repositories were available and two contain no documents under the reader roots at
  all. The size distribution (n = 301) is solid; the per-repository document count is not.
  Revisit the AC-5 discovery caps once real customer repositories are indexed.]
- [NEEDS CLARIFICATION: Follow-up feature, out of scope here — automatic selection of relevant
  documents from the PR's content. It should be specified separately and must preserve this
  feature's audit trail (AC-29 to AC-31, AC-44) so a machine-chosen document is as visible as a
  human-chosen one.]
