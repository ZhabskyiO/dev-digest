/**
 * Smart Diff tuning — every threshold and every path pattern the classifier
 * uses lives HERE, not inline in `classify.ts`. Retuning what counts as
 * boilerplate must never mean editing classification logic.
 *
 * Paths are GitHub PR-file paths: repo-relative, always `/`-separated, never
 * with a leading slash. Patterns are written against that shape — a rule that
 * needs to match a path segment starts with `(^|/)`.
 */

import type { SmartDiffRole } from '@devdigest/shared';

/** Fixed reviewer order. Renderers must not re-sort this. */
export const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'] as const;

/**
 * First match wins, and the list is scanned top to bottom — so ORDER MATTERS.
 * Boilerplate is tested before wiring because the more mechanical a file is,
 * the more specific its pattern: `package-lock.json` must not fall through to
 * the generic `*.json` config rule and land in wiring.
 *
 * Anything matching nothing here is `core`. That default is deliberate: an
 * unrecognised path is far more likely to be business logic than generated
 * output, and mis-filing real logic as boilerplate (collapsed, "skim") is the
 * one error mode that actually loses a reviewer's attention.
 */
export const CLASSIFY_RULES: readonly { role: SmartDiffRole; pattern: RegExp }[] = [
  // ---- boilerplate: generated, vendored, or mechanical -------------------
  // Dependency lockfiles. The acceptance criterion "a lockfile is ALWAYS
  // boilerplate" rests on this single rule, so it is listed first.
  {
    role: 'boilerplate',
    pattern:
      /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|go\.sum)$/,
  },
  // Manifest bookkeeping — a dependency bump is not a change to review closely.
  { role: 'boilerplate', pattern: /(^|\/)package\.json$/ },
  // Build output and dependency trees.
  {
    role: 'boilerplate',
    pattern: /(^|\/)(dist|build|out|coverage|node_modules|third_party|\.next|\.turbo|\.output)\//,
  },
  // `vendor/` ONLY at the repo root — the Go/PHP dependency-vendoring
  // convention. A NESTED `vendor/` is not reliably third-party: DevDigest's own
  // `client/src/vendor/` is first-party source that is meant to be reviewed
  // (see client/CLAUDE.md), and demoting real source to "skim" is the one
  // misclassification that actually costs a reviewer's attention.
  { role: 'boilerplate', pattern: /^vendor\// },
  // Test snapshots and other committed fixtures.
  { role: 'boilerplate', pattern: /(^|\/)__snapshots__\// },
  { role: 'boilerplate', pattern: /\.snap$/ },
  // Minified bundles and source maps.
  { role: 'boilerplate', pattern: /\.min\.(js|css)$/ },
  { role: 'boilerplate', pattern: /\.map$/ },
  // Codegen output by convention or by toolchain.
  { role: 'boilerplate', pattern: /\.(generated|gen)\.[^/]+$/ },
  { role: 'boilerplate', pattern: /\.pb\.(go|ts|js)$/ },
  { role: 'boilerplate', pattern: /_pb2\.pyi?$/ },
  // Migration TOOL state — drizzle-kit's `migrations/meta/*.json` snapshots and
  // `_journal.json`. Caught on a real PR where a single generated snapshot was
  // 3669 lines and, matching the `migrations/` wiring rule below, sat in the
  // middle of the reviewer's wiring group. The SQL beside it stays wiring; only
  // the tool's own bookkeeping is demoted.
  { role: 'boilerplate', pattern: /(^|\/)migrations?\/meta\// },
  // Tests: mechanical to skim, and their failures surface in CI rather than in
  // review. Demoted, never hidden — they still render, just collapsed and last.
  { role: 'boilerplate', pattern: /\.(test|spec)\.[jt]sx?$/ },
  { role: 'boilerplate', pattern: /(^|\/)(__tests__|__mocks__)\// },

  // ---- wiring: hooks the core into the app -------------------------------
  // Barrel/index files — re-exports, not logic.
  { role: 'wiring', pattern: /(^|\/)index\.[jt]sx?$/ },
  // Process entrypoints and composition roots.
  { role: 'wiring', pattern: /(^|\/)(server|app|main|bootstrap|entry)\.[jt]sx?$/ },
  // Config modules and config files of every common flavour.
  { role: 'wiring', pattern: /(^|\/)(config|settings)\.[jt]sx?$/ },
  { role: 'wiring', pattern: /\.config\.[jt]sx?$/ },
  {
    role: 'wiring',
    pattern:
      /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|\.eslintrc[^/]*|\.prettierrc[^/]*|\.babelrc[^/]*|\.editorconfig|\.nvmrc|\.gitignore|\.dockerignore)$/,
  },
  // Infrastructure and CI.
  { role: 'wiring', pattern: /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|Makefile|Procfile)$/ },
  { role: 'wiring', pattern: /(^|\/)\.github\// },
  // DB migrations: mechanical to read, but they change production data — too
  // consequential to demote to boilerplate, too generated to call core.
  { role: 'wiring', pattern: /(^|\/)migrations?\// },
] as const;

/**
 * A PR whose total changed lines exceed this is flagged `too_big`. 400 is the
 * commonly cited point at which review defect-detection falls off; it is a
 * hint in the UI, never a block.
 */
export const SPLIT_TOO_BIG_LINES = 400;

/** No split is proposed for a PR with fewer files than this, however large. */
export const SPLIT_MIN_FILES = 3;

/** Cap on proposed splits — a list of ten "splits" is noise, not a suggestion. */
export const MAX_PROPOSED_SPLITS = 5;

/**
 * Path prefixes that are containers rather than features: under one of these,
 * the split bucket is the FIRST TWO segments (`src/api`), not the first (`src`),
 * which would put an entire monorepo in one bucket.
 */
export const SPLIT_CONTAINER_DIRS: readonly string[] = [
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'modules',
  'server',
  'client',
] as const;

/** Bucket name for every boilerplate file in a split proposal. */
export const SPLIT_GENERATED_BUCKET = 'generated & lockfiles';
