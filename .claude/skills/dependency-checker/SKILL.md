---
name: dependency-checker
description: "Audits every dependency of a multi-package repo — external npm packages AND the internal edges between packages (tsconfig path aliases, vendored copies, deep imports) — and produces one structured report: Mermaid dependency graphs, a size/type breakdown per package (own / transitive / exclusive MB), version drift across packages, unused deps, module cycles, outdated / vulnerable / non-permissive-licence packages, then a P0–P2 prioritized findings list with concrete, confirm-before-acting recommendations. Use it whenever someone asks to analyze, audit, map, draw, visualize, slim down, dedupe, or 'check' dependencies; asks why node_modules is so big, which packages are heaviest or unused, whether versions drift between server/client/reviewer-core, or how the packages depend on each other — even if they never say 'dependency checker'. Also use before a major upgrade or when deciding whether to remove/replace a library. NOT for layering reviews inside one package (use onion-architecture) and NOT for wiring a new dependency behind a port/adapter (also onion-architecture)."
version: "1.0.0"
---

# Dependency Checker

Dependencies are where size, security exposure and hidden coupling accumulate quietly: nobody
adds 300 MB or a second copy of a contract on purpose, it happens one `pnpm add` at a time. This
skill produces **one report a developer can act on in priority order** — numbers with evidence,
graphs of what depends on what, and recommendations ranked by impact — instead of a wall of
`pnpm ls` output.

Two kinds of dependency are in scope, and the report keeps them apart because they fail
differently:

| Kind | What it is | Where it's declared | Typical failure |
|------|-----------|---------------------|-----------------|
| **External** | npm packages (`fastify`, `next`, `zod`) | `package.json` + lockfile | bloat, CVEs, drift between packages, dead weight |
| **Internal** | one of *our* packages reaching into another | `tsconfig.json` `paths` aliases, relative `../other/` imports, vendored copies under `src/vendor/` | copies drifting apart, deep imports bypassing a package's entry point, accidental direction reversals |

In DevDigest specifically the packages (`server/`, `client/`, `reviewer-core/`, `e2e/`,
`mcp-server/`, `evals/`) are **standalone — not a pnpm workspace**: each has its own lockfile and
they share code only through path aliases and vendored copies (`@devdigest/shared` canonical in
`server/src/vendor/shared`, copied into `client/`). Never describe them as `workspace:*` links.

## What you deliver

- **One Markdown report** in the exact structure of [references/report-template.md](references/report-template.md):
  `1. Scope → 2. Dependency Graph → 3. Size & Type Breakdown → 4. Findings & Priorities → 5. Summary`.
  The structure is fixed on purpose — teams compare reports over time and reviewers know where
  to look. Fill every section; write `none found` rather than dropping a heading.
  **A narrow question still gets the report.** "What's dead weight?", "what should we upgrade?"
  or "only the internal edges" shrink the sections that don't apply to a line or two — they
  don't replace the skeleton with a bullet list. The findings section is where the answer lives,
  the size table is its proof, and a reader of a dead-weight answer will ask "and what about the
  300 MB row you skipped?" for every heavy dependency the report is silent on.
- **Recommendations only — no mutations.** Never run `pnpm add/remove/update`, never edit a
  `package.json` or a lockfile as part of this skill. Removing a dependency is a behaviour change
  (framework conventions, dynamic `import()`, CLI bins in CI all hide usage), so the report ends
  with the commands the user *could* run and waits for confirmation.
- **Severity from the rubric**, not from instinct: [references/severity-rubric.md](references/severity-rubric.md)
  defines P0 / P1 / P2 / Info and a catalog of finding types with their default tier.

## Workflow

### 1. Scope

List the packages you will analyze: every directory with a `package.json` (skip `node_modules`,
`clones/`, `.next/`, `dist/`). Note the package manager and whether the packages are linked
(workspace) or standalone — it changes what "the same dependency in two packages" means (two
lockfiles can resolve the same range to different versions). Honour a subset if the user names
one. State exclusions explicitly so nobody assumes `server/clones` was scanned.

### 2. Collect — run the script, don't hand-gather

```bash
node .claude/skills/dependency-checker/scripts/collect-deps.mjs --md --out <scratch>/deps.json
#   --no-network      skip outdated / audit / licenses (≈1–2 s instead of ≈30 s per package)
#   --packages a,b    limit to some package dirs        --top 15   rows per size table
```

The script is deterministic and zero-dependency; it prints paste-ready Markdown (tables +
Mermaid) and can dump the full JSON. It computes the things that are slow or error-prone to do by
hand: per-dependency **own / transitive / exclusive** size through pnpm's symlinked store,
**usage evidence** (imports, bins referenced by scripts, names in config files), **drift** of
declared ranges *and* installed versions across packages, **internal edges** from tsconfig
aliases, **vendored-copy diffs**, **deep imports** with `file:line`, **module cycles** (Tarjan)
and, with network, `outdated` / `audit` / `licenses`. Run with network unless the user is in a
hurry or offline — the security and outdated sections are where P0s come from.

If the script cannot run (no Node repo, no filesystem access, or the data is **already given
in the prompt**), use what you have and the manual checklist in the rubric's
*Manual collection* section. Do not ask for more data before producing the report; mark gaps as
`not measured` in Scope, and make "re-run with network / run `pnpm audit` + `pnpm outdated`" an
explicit item in the Summary's next steps — otherwise the reader takes silence on security as
"no issues".

### 3. Analyze — turn facts into findings

Walk the finding catalog in the rubric category by category: **internal coupling → duplication
& drift → dead weight → size → hygiene (outdated / deprecated) → security → licensing → graph
health**. Each finding must carry: *what & where* (package + dependency or `file:line`),
*evidence* (the number or the quoted line), *why it matters*, *fix*, *effort* (S / M / L) and
*tier*. Merge related facts into one finding — three `zod` ranges and two installed versions is
**one** drift finding with three rows of evidence, not three findings.

Judgement calls the numbers don't make for you:

- **`unreferenced` ≠ unused.** Before calling a dependency dead, check framework conventions
  (Next.js, PostCSS/Tailwind plugins, a vitest `environment`, Fastify autoload), dynamic
  `import()`, and bins used by CI or shell scripts. Say what you checked. A comment mentioning
  the package is *not* usage. When the collector's usage column already carries the explanation
  (`unreferenced (vitest.config.ts sets environment: "jsdom")`), that **is** the usage: report
  it as used-via-config, not as a removal candidate — not even a "conditional" one.
- **Quote the right size.** *Exclusive* size is what removing a dependency actually frees;
  *transitive* size is what makes it heavy; *own* size alone is misleading for anything with
  dependencies of its own. Prod-only weight affects the shipped artifact and attack surface;
  dev-only weight affects install and CI time — name which, every time you discuss weight.
- **Address the heaviest dependencies explicitly, even when they're fine.** When the question
  is "what's dead weight / why is node_modules so big", the reader's eye goes straight to the
  biggest rows; if the report is silent on them they assume you missed them. One line each:
  *why* it's acceptable (already lazy-loaded, tree-shaken at build, the data is inherent) or
  *what* the cheaper option is (a heavy library used in one file for one function → P2).
- **Security tier follows prod reachability, not the CVSS word.** A *critical* advisory reached
  only through dev dependencies is P1 (it never ships); a *high* one in a prod dependency is P0.
  One advisory hitting several packages is **one** finding with several evidence rows.
- **Vendored copies that differ are a correctness risk**, not a style issue: contracts diverge
  silently until a request fails validation on one side. Identify the canonical copy from project
  docs (`CLAUDE.md`, `README.md`) — the script cannot know which side is canonical.
- **Deep imports** (relative `../other-package/src/…` or an alias sub-path like
  `@devdigest/reviewer-core/src/x`) bypass the target's public entry point and its tsconfig; they
  break the moment the target is built or moved separately. Call them out by `file:line`.
- **Cycles through a DI composition root** (`container ↔ service`) are a known trade-off of the
  style; same-module cycles (`helpers ↔ repository`) are bugs waiting to happen. Rank accordingly.
- **Drift of a runtime library that crosses a package boundary** (a `zod` schema produced by one
  package and parsed by another) matters more than drift of a dev tool. Major-version drift of
  TypeScript across packages is mostly a CI-consistency issue.

### 4. Prioritize

Assign tiers from the rubric, then order within a tier by impact (MB freed, vulnerabilities
closed, number of files affected). If there are more than ~12 findings, keep the top ones per
tier and fold the rest into an *Also noted* list — a forty-item list is not a priority list.
Every P0 and P1 must name a concrete next action; P2/Info may be grouped ("bump the 6
minor-outdated Fastify plugins together").

### 5. Write the report

Follow the template. **Paste the script's tables and Mermaid blocks verbatim** — they are
deterministic; retyping numbers introduces errors — and add one or two sentences of reading
guidance under each. Always include the internal graph; include the external footprint graph
when there are ≥2 packages or >10 dependencies. Findings use tier headings and the fixed
mini-format from the template. The Summary is 3–5 ordered takeaways, each with its expected gain,
followed by *Next steps — confirm before I act* listing exact commands (`pnpm remove …`,
`pnpm update … --latest`) that you have **not** run.

## Severity at a glance

| Tier | Meaning | Examples |
|------|---------|----------|
| **P0** | Broken now, or exploitable in shipped code | critical/high CVE in a *prod* dependency; vendored contract copies that differ; an internal edge pointing the wrong direction through an enforced boundary (e.g. into `reviewer-core` from I/O) |
| **P1** | Structural risk — fix this sprint | deep cross-package imports; runtime-library drift across a package boundary; unused **prod** dependency; deprecated package still in use; moderate CVE |
| **P2** | Hygiene — batch into a maintenance PR | dev-dependency drift; major-version bumps available; heavy dependency with a lighter alternative; same-module cycle |
| **Info** | Worth knowing, no action required | size league table; DI-root cycles; minor/patch bumps; licence summary |

Full definitions and the finding catalog: [references/severity-rubric.md](references/severity-rubric.md).

## Gotchas (pnpm + standalone packages)

- `du` on `node_modules/<pkg>` follows no symlinks, so it reports a few KB for a pnpm-linked
  package — the script resolves realpaths into `.pnpm/` before measuring. Don't trust raw `du`.
- `pnpm outdated` / `pnpm audit` exit non-zero *when they find something*; the JSON is still on
  stdout. The script tolerates this; a hand-run in a `set -e` shell will not.
- Each standalone package has its own lockfile, so the same `^3.24.1` can resolve differently in
  two packages — always report *installed* versions next to declared ranges.
- `server/clones/**` contains a full copy of this repo; never count it (the script skips it).
