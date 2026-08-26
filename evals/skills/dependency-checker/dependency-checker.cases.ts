import type { SkillCase } from "../../src/index.js";

// dependency-checker normally runs `scripts/collect-deps.mjs --md` and reasons over its output.
// "quality" cases run content-only (SKILL.md + references/*.md as the system prompt, NO tools —
// see src/tasks.ts), so every prompt inlines a dataset shaped exactly like the collector's
// Markdown output. Each case isolates one judgement rule from SKILL.md / severity-rubric.md;
// the first one checks the output contract from references/report-template.md as a whole.

const PREAMBLE = `Below is the output of collect-deps.mjs --md for this repo — treat it as already collected and write the report directly from it. Do not ask for tool access or more data. The packages are standalone (one pnpm lockfile each), linked only by tsconfig path aliases and vendored copies — there is no pnpm workspace. Per CLAUDE.md, the canonical copy of @devdigest/shared is server/src/vendor/shared.`;

const PACKAGES = `## Packages

| Package | Dir | Manager | Prod | Dev | Installed (node_modules) | Internal edges (out) |
|---|---|---|---|---|---|---|
| @devdigest/web | client | pnpm | 18 | 12 | 627.8 MB | — |
| @devdigest/reviewer-core | reviewer-core | pnpm | 2 | 4 | 78.1 MB | api |
| @devdigest/api | server | pnpm | 23 | 8 | 239.0 MB | reviewer-core |

## Internal edges (tsconfig paths)

- server: @devdigest/reviewer-core -> ../reviewer-core/src/index.ts (cross-package); @devdigest/shared -> ./src/vendor/shared (vendored)
- reviewer-core: @devdigest/shared -> ../server/src/vendor/shared (cross-package, into the server tree)
- client: @devdigest/shared -> ./src/vendor/shared (vendored); @/* -> ./src/* (self)`;

const SIZES = `## Size breakdown — @devdigest/web (client/, node_modules 627.8 MB)

| Dependency | Type | Declared → installed | Own | Transitive | Exclusive | Usage |
|---|---|---|---|---|---|---|
| next | prod | ^15.1.3 → 15.5.19 | 152.6 MB | 301.3 MB (18 pkgs) | 296.7 MB | used |
| mermaid | prod | ^11.15.0 → 11.15.0 | 75.3 MB | 139.5 MB (111 pkgs) | 136.4 MB | used — only via await import("mermaid") in client/src/components/mermaid-diagram/MermaidDiagram.tsx:36 |
| lucide-react | prod | ^0.469.0 → 0.469.0 | 36.2 MB | 36.2 MB (1 pkgs) | 36.2 MB | used |
| jsdom | dev | ^25.0.1 → 25.0.1 | 4.1 MB | 18.1 MB (60 pkgs) | 17.3 MB | unreferenced (no import; vitest.config.ts sets environment: "jsdom") |
| date-fns | prod | ^4.1.0 → 4.1.0 | 22.0 MB | 22.0 MB (1 pkgs) | 22.0 MB | used — 1 import, client/src/lib/format-date.ts (formatDistance only) |
| zod | prod | ^3.24.1 → 3.25.76 | 5.0 MB | 5.0 MB (1 pkgs) | 0 KB | used |

## Size breakdown — @devdigest/api (server/, node_modules 239.0 MB)

| Dependency | Type | Declared → installed | Own | Transitive | Exclusive | Usage |
|---|---|---|---|---|---|---|
| @testcontainers/postgresql | dev | ^10.16.0 → 10.28.0 | 40 KB | 45.4 MB (172 pkgs) | 40 KB | used |
| testcontainers | dev | ^10.16.0 → 10.28.0 | 1.2 MB | 45.3 MB (171 pkgs) | 0 KB | used |
| js-tiktoken | prod | ^1.0.21 → 1.0.21 | 21.5 MB | 21.5 MB (2 pkgs) | 21.5 MB | used |
| drizzle-orm | prod | ^0.38.3 → 0.38.4 | 13.2 MB | 13.2 MB (1 pkgs) | 13.2 MB | used |
| @fastify/autoload | prod | ^6.0.3 → 6.3.1 | 1.2 MB | 1.2 MB (3 pkgs) | 1.2 MB | unreferenced (only mention is a comment in server/src/modules/index.ts:22 saying modules are registered explicitly instead of autoload) |
| zod | prod | ^3.24.1 → 3.25.76 | 5.0 MB | 5.0 MB (1 pkgs) | 5.0 MB | used |

## Size breakdown — @devdigest/reviewer-core (reviewer-core/, node_modules 78.1 MB)

| Dependency | Type | Declared → installed | Own | Transitive | Exclusive | Usage |
|---|---|---|---|---|---|---|
| vitest | dev | ^2.1.8 → 2.1.9 | 1.9 MB | 33.2 MB (44 pkgs) | 33.0 MB | used |
| zod | prod | ^3 → 3.24.1 | 4.8 MB | 4.8 MB (1 pkgs) | 4.8 MB | used |`;

const DRIFT = `## Version drift across packages

| Dependency | Declared (package: range → installed) | Ranges differ | Installed differ |
|---|---|---|---|
| zod | web: ^3.24.1 → 3.25.76; api: ^3.24.1 → 3.25.76; reviewer-core: ^3 → 3.24.1 | yes | yes |
| typescript | web: ^5.7.2 → 5.9.3; api: ^5.7.2 → 5.9.3; reviewer-core: ^5.6.0 → 5.9.3 | yes | no |
| vitest | web: ^2.1.8 → 2.1.9; api: ^2.1.8 → 2.1.9; reviewer-core: ^2.1.8 → 2.1.9 | no | no |`;

const INTERNAL = `## Vendored copies

- @devdigest/shared: client/src/vendor/shared, server/src/vendor/shared
  - differs in 2 file(s): contracts/eval-ci.ts, contracts/productionize.ts (server copy exports AgentManifest and CiFailOn; client copy does not)

## Deep / cross-package imports

| Package | File | Import | Kind | Resolves to |
|---|---|---|---|---|
| api | server/src/modules/reviews/run-executor.ts:14 | @devdigest/reviewer-core/src/grounding | alias-subpath-bypasses-entry | reviewer-core (reviewer-core/src/grounding.ts) |
| reviewer-core | reviewer-core/src/pipeline.ts:3 | ../../server/src/adapters/llm/openai.js | relative-cross-package | server/src/adapters/llm/openai.ts |

## Module graph per package

| Package | Files | Edges | Cycles (SCCs) | Largest cycle | Top fan-in hub |
|---|---|---|---|---|---|
| web | 464 | 684 | 0 | — | client/src/vendor/ui/icons.tsx (24) |
| reviewer-core | 8 | 12 | 0 | — | reviewer-core/src/grounding.ts (3) |
| api | 170 | 456 | 2 | 9 files: platform/container.ts ↔ modules/blast/service.ts ↔ modules/onboarding/service.ts ↔ modules/repo-intel/service.ts … (all via platform/container.ts) | server/src/db/schema.ts (26) |

Second api cycle: 2 files, modules/agents/helpers.ts ↔ modules/agents/repository.ts (no container involvement).`;

const NETWORK = `## Outdated — major bumps and deprecations

| Package | Dependency | Type | Current → latest | Bump | Deprecated |
|---|---|---|---|---|---|
| web | next | prod | 15.5.19 → 16.3.2 | major | no |
| web | zod | prod | 3.25.76 → 4.4.3 | major | no |
| web | recharts | prod | 2.15.4 → 3.10.1 | major | no |
| api | zod | prod | 3.25.76 → 4.4.3 | major | no |
| api | fastify-type-provider-zod | prod | 4.0.2 → 7.0.0 | major | no |
| api | octokit | prod | 4.1.4 → 5.0.5 | major | no |
| api | request | prod | 2.88.2 → 2.88.2 | none | **yes** (deprecated upstream, use fetch/undici) |
| reviewer-core | zod | prod | 3.24.1 → 4.4.3 | major | no |

api: 9 minor (fastify, drizzle-orm, @fastify/helmet, @fastify/rate-limit, @fastify/cors, @ast-grep/napi, drizzle-kit, @anthropic-ai/sdk, tsx), 4 patch.

## Vulnerabilities (audit)

| Package | Critical | High | Moderate | Low | Top advisories (module · severity · via top-level dep) |
|---|---|---|---|---|---|
| web | 1 | 3 | 6 | 1 | vitest · critical · via vitest (dev) — GHSA-5xrq-8626-4rwp, patched >=3.2.6; next · high · via next (prod) — GHSA-m99w-x7hq-7vfj DoS in App Router Server Actions, patched >=15.5.21; sharp · high · via next (prod) — libvips CVEs, patched >=0.35.0; form-data · high · via jsdom (dev) |
| api | 1 | 4 | 5 | 2 | vitest · critical · via vitest (dev) — GHSA-5xrq-8626-4rwp, patched >=3.2.6; drizzle-orm · high · via drizzle-orm (prod) — GHSA-gpj5-g38j-94v9 SQL injection via improperly escaped identifiers, patched >=0.45.2; undici · high · via testcontainers (dev); brace-expansion · high · via testcontainers (dev) |
| reviewer-core | 1 | 1 | 1 | 0 | vitest · critical · via vitest (dev) — GHSA-5xrq-8626-4rwp, patched >=3.2.6; vite · high · via vitest (dev) |

## Licenses

| Package | Summary | Non-permissive / unknown |
|---|---|---|
| web | MIT: 380, ISC: 42, Apache-2.0: 10, BSD-3-Clause: 10, MPL-2.0: 2 | @img/sharp-libvips-darwin-arm64 (LGPL-3.0-or-later, via next → sharp), khroma (Unknown, via mermaid) |
| api | MIT: 317, ISC: 27, Apache-2.0: 24, BSD-3-Clause: 18, BlueOak-1.0.0: 5 | none |
| reviewer-core | MIT: 76, Apache-2.0: 3, ISC: 2 | none |`;

const FULL_DATA = [PREAMBLE, PACKAGES, SIZES, DRIFT, INTERNAL, NETWORK].join("\n\n");

export const cases: SkillCase[] = [
  {
    name: "report follows the 5-section contract from report-template.md",
    kind: "quality",
    prompt: `Run a full dependency check on DevDigest — graph, sizes, prioritized findings, recommendations.\n\n${FULL_DATA}`,
    grounding: ["```mermaid", "flowchart", "## 1. Scope", "## 5. Summary"],
    practices: [
      "the report has exactly the five numbered top-level sections in this order: '1. Scope', '2. Dependency Graph', '3. Size & Type Breakdown', '4. Findings & Priorities', '5. Summary'",
      "the Scope section names the three packages (client/web, server/api, reviewer-core) AND states they are standalone packages linked by path aliases / vendored copies, not a pnpm workspace",
      "the Dependency Graph section contains a fenced ```mermaid flowchart whose edges are between the packages (web, api, reviewer-core and the vendored @devdigest/shared), not between npm libraries only",
      "the Size & Type Breakdown contains a Markdown table with Own, Transitive and Exclusive size columns (the collector's columns), not a prose restatement of sizes",
      "findings are grouped under explicit tier headings P0, P1, P2 and Info, and each P0/P1 finding has Evidence, Why it matters, Fix and Effort lines",
      "the Summary section lists 3 to 5 numbered takeaways ordered by priority",
      "there is a 'Next steps — confirm before I act' block (inside or right after the Summary) containing shell commands that are explicitly described as not executed",
      "each Mermaid diagram in section 2 and each size table in section 3 is followed by one or two sentences of reading guidance saying what to notice in it",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "unreferenced ≠ unused: framework/config usage is recognised, a real dead prod dep is flagged, exclusive size is quoted",
    kind: "quality",
    prompt: `Which dependencies in client/ and server/ are dead weight? Tell me what to remove and what it saves.\n\n${PREAMBLE}\n\n${PACKAGES}\n\n${SIZES}`,
    practices: [
      "@fastify/autoload in server/package.json is called out as an unused prod dependency (the only mention is a comment in server/src/modules/index.ts:22), tiered P1",
      "jsdom in client/ is NOT recommended for removal — the answer explains it is used through vitest.config.ts environment: \"jsdom\" even though nothing imports it",
      "mermaid is NOT treated as a problem to fix: the answer notes it is already lazy-loaded via await import(\"mermaid\") in MermaidDiagram.tsx:36, so its 139.5 MB is an Info item",
      "the saving quoted for removing @fastify/autoload is its exclusive size (1.2 MB), and the answer does not quote a dependency's own size as what removal would free for packages whose exclusive size differs from own size (e.g. testcontainers exclusive 0 KB vs own 1.2 MB, or zod in client exclusive 0 KB)",
      "prod weight and dev weight are distinguished explicitly — e.g. testcontainers / jsdom cost install and CI time, not the shipped artifact",
      "date-fns (22 MB, one import using formatDistance only) is suggested as a P2 'heavy dep used for one function' candidate, not a P0/P1",
      "removal is presented as a command for the user to confirm (e.g. pnpm remove @fastify/autoload) and not described as already done",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "internal edges: vendored-copy drift is P0 with the canonical side taken from docs; deep imports are cited by file:line; DI-root cycles are Info",
    kind: "quality",
    prompt: `Focus on how our packages depend on each other internally — aliases, vendored copies, cross-package imports, cycles. I only need sections 2 and 4 of the report.\n\n${PREAMBLE}\n\n${PACKAGES}\n\n${INTERNAL}`,
    practices: [
      "the drift between client/src/vendor/shared and server/src/vendor/shared (contracts/eval-ci.ts, contracts/productionize.ts) is a P0 finding, and the fix re-syncs FROM server (named as canonical per CLAUDE.md) TO client — not the other way round and not 'pick one'",
      "server/src/modules/reviews/run-executor.ts:14 importing @devdigest/reviewer-core/src/grounding is flagged as a deep import that bypasses reviewer-core's public entry point, with the file:line cited, tiered P1",
      "reviewer-core/src/pipeline.ts:3 importing ../../server/src/adapters/llm/openai.js is flagged as P0 (the pure core importing a server I/O adapter reverses the dependency direction through an enforced boundary), not merely as a style issue",
      "the 9-file cycle through platform/container.ts is classified as Info (accepted DI-root trade-off), not as a P0/P1/P2 finding",
      "the 2-file agents/helpers.ts ↔ agents/repository.ts cycle is a P2 finding (a genuine same-module cycle), tiered above the container cycle but below the deep imports",
      "the answer describes the sharing mechanism as tsconfig path aliases and vendored copies, and never says the packages are linked via workspace:* or a pnpm workspace",
      "the Mermaid graph marks the vendored @devdigest/shared copies as differing and shows reviewer-core's alias resolving into the server tree",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "security & hygiene tiers follow the rubric: prod-high → P0, critical-via-dev → P1, majors batched, licences to confirm",
    kind: "quality",
    prompt: `We need to decide what to upgrade this sprint. Prioritise our security and outdated-dependency situation.\n\n${PREAMBLE}\n\n${PACKAGES}\n\n${DRIFT}\n\n${NETWORK}`,
    practices: [
      "the drizzle-orm SQL-injection advisory (GHSA-gpj5-g38j-94v9, prod in server) and the next App Router DoS advisory (GHSA-m99w-x7hq-7vfj, prod in client) are P0, and each evidence line names the advisory id or the patched version (>=0.45.2, >=15.5.21)",
      "the critical vitest advisory (GHSA-5xrq-8626-4rwp) is tiered P1, not P0, with the reasoning that it is reachable only through a dev dependency",
      "the vitest advisory is handled as ONE finding covering web, api and reviewer-core rather than three separate findings",
      "the deprecated 'request' package in server is a P1 finding with a migration to fetch/undici as the fix",
      "the zod drift is ONE finding that combines the range drift (^3 vs ^3.24.1), the differing installed versions (3.24.1 vs 3.25.76) and the fact that zod schemas cross the package boundary via @devdigest/shared — not one finding per package or per fact",
      "major-version bumps (next 16, recharts 3, fastify-type-provider-zod 7, octokit 5, zod 4) are grouped into a P2 batch/plan with suggested PR grouping, not listed as one finding per dependency and not placed in P0/P1",
      "the LGPL libvips binary (via next → sharp) and the Unknown-licence khroma are flagged as items for a human to confirm and record, tiered below P0 (P1 at most), and not described as a reason to block a release",
      "the 9 minor and 4 patch bumps in server appear as a single batch item (an Info line or one grouped P2 finding), not as one finding per dependency",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "partial data: marks what was not measured, never fabricates audit or outdated results, keeps all five sections",
    kind: "quality",
    prompt: `Quick offline dependency check please — I ran the collector with --no-network so there is no audit, outdated or licence data. Give me the full report anyway.\n\n${PREAMBLE}\n\n${PACKAGES}\n\n${SIZES}\n\n${DRIFT}\n\n${INTERNAL}\n\n_Outdated / audit / licenses skipped (--no-network)._`,
    practices: [
      "the Scope section has a 'Not measured' (or equivalently worded) entry that explicitly lists audit/vulnerabilities, outdated versions and licences as skipped because of --no-network",
      "the report contains NO vulnerability counts, advisory ids, CVE numbers, 'latest version' numbers or licence names — nothing that could only come from the skipped network commands",
      "all five numbered sections are still present (Scope, Dependency Graph, Size & Type Breakdown, Findings & Priorities, Summary) rather than dropping the ones with less data",
      "the findings supported by the offline data — vendored-copy drift, the two deep imports, @fastify/autoload unreferenced, zod drift — each appear under a tier heading (P0/P1/P2/Info)",
      "re-running the collector with network (or running pnpm audit / pnpm outdated) is recommended in the Summary or in the next-steps block",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
