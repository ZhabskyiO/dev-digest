# dependency-checker — provenance & maintenance

A DevDigest-authored skill (no upstream). It audits external npm dependencies **and** the
internal edges between our standalone packages, and emits one fixed-structure report with
Mermaid graphs, size tables and P0–P2 prioritized recommendations.

## Layout

```
dependency-checker/
├── SKILL.md                       workflow, judgement rules, severity at a glance
├── references/
│   ├── report-template.md         the exact 5-section output contract + finding mini-format
│   └── severity-rubric.md         P0/P1/P2/Info definitions, finding catalog, manual fallback
├── scripts/
│   └── collect-deps.mjs           zero-dependency collector (JSON or paste-ready Markdown)
└── README.md                      this file
```

The eval harness (`evals/`) injects `SKILL.md` **plus every `references/*.md`** as the system
prompt and runs quality cases content-only (no tools). That is why the output contract and the
rubric live in `references/` and not only in the script: the skill must be able to produce the
report from data handed to it in the prompt.

## Running the collector

```bash
node .claude/skills/dependency-checker/scripts/collect-deps.mjs --md                 # full, with network
node .claude/skills/dependency-checker/scripts/collect-deps.mjs --md --no-network    # ≈1–2 s
node .claude/skills/dependency-checker/scripts/collect-deps.mjs --out deps.json      # JSON only
```

Design choices worth knowing before changing it:

- **Sizes** are computed by resolving each dependency's realpath under `node_modules/.pnpm/` and
  walking `dependencies` + `optionalDependencies` from each package's own `package.json` (plain
  Node resolution, so it also works on npm's flat layout). *Exclusive* size counts store entries
  reachable from exactly one top-level dependency — the honest "what removing it frees" number.
- **Usage evidence** is three independent signals: an import specifier in source, a `bin` of
  the package used in `package.json` scripts, or the package name in a root-level config file /
  `scripts/` / `.github/`. `unreferenced` means none fired; the skill text tells the model that
  this is a hint, not proof.
- **tsconfig is JSONC** (`stripJsonc` is string-aware — the naive `/* … */` regex ate `"x/*"`
  aliases). One level of `extends` is followed.
- **Network commands** (`pnpm outdated|audit|licenses`) exit non-zero when they find something;
  `run()` keeps stdout in that case. Missing tools degrade to `available: false`, never abort.

## Evals

```bash
cd evals && pnpm eval:quality                              # static gate (frontmatter, length, eval file present)
cd evals && pnpm vitest run skills/dependency-checker      # 3 LLM-judged quality cases
cd evals && pnpm eval:benchmark skills/dependency-checker -n 3   # lift vs. no-skill baseline
```

Cases live in `evals/skills/dependency-checker/dependency-checker.cases.ts` and inline a
synthetic dataset (the skill normally gathers it with the script).
