import type { CommunitySkill } from '@devdigest/shared';

/**
 * Curated, in-repo catalog of community skills for `GET /skills/community`.
 *
 * Honest caveat: `stars` and `repo` below are a **static snapshot recorded at
 * authoring time**, not live data — nobody is polling GitHub for these numbers
 * and they will drift out of date. A later upgrade could back this catalog
 * with real GitHub search through the existing octokit adapter
 * (`adapters/github/octokit.ts`); that is deliberately not done here, this is
 * a hand-picked, hard-coded list.
 *
 * `repo` doubles as this entry's stable id: `SkillImportRequest`'s `community`
 * variant (`contracts/skills-studio.ts`) carries an `id` that is matched
 * against `repo` to find the entry to import.
 *
 * This module is standalone — it does not import from `repository.ts`,
 * `service.ts`, or `routes.ts` in this feature, and nothing wires it in yet;
 * that happens in a later step.
 */

/**
 * Internal shape used only inside this module (and by the later import flow)
 * — adds the full markdown `body`, which is deliberately NOT part of the
 * public `CommunitySkill` DTO returned to the client list view.
 */
export interface CommunitySkillEntry extends CommunitySkill {
  body: string;
}

// This array is intentionally just a plain literal list so appending another
// entry later is a one-line change.
export const COMMUNITY_SKILLS: CommunitySkillEntry[] = [
  {
    name: 'Conventional Commits',
    repo: 'conventional-commits/conventionalcommits.org',
    stars: 3800,
    lang: 'JavaScript',
    desc: 'Enforces the Conventional Commits format so history stays machine-parseable and changelogs can be generated automatically.',
    body: `# Conventional Commits

Use the Conventional Commits format for every commit message so history stays
machine-parseable and changelogs can be generated automatically.

## Format

    <type>(<scope>): <short summary>

    [optional body]

    [optional footer(s)]

## Types

- \`feat\` — a new feature for the user
- \`fix\` — a bug fix for the user
- \`docs\` — documentation only changes
- \`style\` — formatting, missing semicolons, etc; no code change
- \`refactor\` — code change that neither fixes a bug nor adds a feature
- \`perf\` — a code change that improves performance
- \`test\` — adding or correcting tests
- \`chore\` — tooling, build process, or auxiliary changes

## Rules

- Summary is imperative mood, present tense: "add", not "added" or "adds".
- Summary is lowercase, no trailing period, under ~72 characters.
- Scope is optional but recommended for monorepos: \`fix(api): ...\`.
- Breaking changes get a \`!\` after the type/scope AND a \`BREAKING CHANGE:\`
  footer explaining the change: \`feat(auth)!: drop legacy token format\`.
- Body explains *why*, not *what* — the diff already shows what changed.
- Reference issues in the footer: \`Closes #123\`, \`Refs #456\`.

## Flag in review

- Vague summaries: "fix stuff", "update", "wip", "misc changes".
- Multiple unrelated changes bundled into a single commit — suggest a split.
- Missing \`!\` / \`BREAKING CHANGE:\` footer on a change that alters a public
  API, changes a default, or removes a field.
- Type mismatched to the actual change (e.g. \`fix\` for a new feature).`,
  },
  {
    name: 'Code Review Rubric',
    repo: 'google/eng-practices',
    stars: 13500,
    lang: 'Markdown',
    desc: 'A structured, design-first checklist for what to look for in a code review, adapted from widely used industry review guides.',
    body: `# Code Review Rubric

A structured checklist for reviewing a pull request, adapted from widely used
industry review guides. Apply top-down: design first, nits last.

## 1. Design
- Does this change belong here, or does it fight the existing architecture?
- Is the change reasonably scoped, or should it be split into smaller PRs?
- Does it introduce coupling that will be expensive to undo later?

## 2. Functionality
- Does the code do what the author intended, including edge cases (empty
  input, concurrent access, network failure)?
- Are there user-facing behavior changes that need a changelog entry or a
  migration note?

## 3. Complexity
- Can a reviewer understand the code on first read, or does it need a second
  pass? Over-engineered abstractions are a smell, not a virtue.
- Are functions and files doing one thing, or several?

## 4. Tests
- Does the diff include tests for new logic and for the bug it fixes?
- Do the tests actually fail without the fix (not just pass with it)?
- Are tests readable enough to serve as documentation?

## 5. Naming & Style
- Are names precise enough that a reader doesn't need to open the
  implementation to guess what they do?
- Does it follow the project's existing conventions rather than silently
  introducing a new one?

## 6. Comments & Docs
- Do comments explain *why*, not restate *what* the code already says?
- Is public-facing documentation (README, API docs) updated alongside the
  behavior it describes?

## Severity guidance

- Block the PR: broken functionality, missing tests for risky logic, security
  or data-loss risk.
- Request changes but don't block: naming, structure, minor complexity.
- Nit (prefix with "Nit:"): style preferences the author can take or leave.`,
  },
  {
    name: 'Flaky Test Patterns',
    repo: 'devdigest-community/flaky-test-patterns',
    stars: 940,
    lang: 'TypeScript',
    desc: 'Catches time/date dependence, randomness, ordering assumptions, and network dependence that make tests fail intermittently instead of deterministically.',
    body: `# Flaky Test Patterns

Flag test code in this diff that can pass or fail depending on when, in what
order, or how fast it runs, rather than on whether the code under test is
correct. A flaky test is worse than no test: it erodes trust in the whole
suite and teaches people to re-run CI instead of reading the failure.

## Time and date dependence

- \`new Date()\`, \`Date.now()\`, or a duration computed from "now" used directly
  in an assertion — freeze or inject the clock instead (a fake timer, an
  injected \`now()\` provider) so the test result doesn't depend on the instant
  it happens to run.
- Assertions with an implicit real-time wait (\`setTimeout\`/\`sleep\` before
  asserting) instead of awaiting the actual async condition — these are slow
  AND flaky, since the wait is either too short under load or wastefully long.
- Date-range logic tested only against the current date, with no case near a
  boundary (midnight, month/year rollover, DST transition) that would catch an
  off-by-one in the range math.

## Randomness

- \`Math.random()\`, a UUID, or any non-deterministic generator feeding a value
  the test then asserts on directly — seed the generator or inject a fixed
  value so the test is reproducible.
- A test that only sometimes exercises a code path because the input is
  randomly generated per run — pin the input, or explicitly test each branch.

## Ordering assumptions

- Asserting an exact array/object-key order from a source that does not
  guarantee one (a DB query without \`ORDER BY\`, \`Object.keys\`, a \`Promise.all\`
  over concurrent work, a Set/Map iteration relied on for order).
- Tests that only pass when run in a specific order because they share mutable
  state (a module-level variable, a shared fixture, leftover DB rows) — each
  test should set up and tear down its own state.
- Concurrency-dependent assertions (asserting which of two racing operations
  "won") without an actual synchronization point forcing the order.

## Network / external dependence

- A test that makes a real HTTP call to a third-party service (GitHub, an LLM
  provider, any external API) instead of using this codebase's mock/fake
  adapters — fails on rate limits, outages, or plain network flakiness that
  has nothing to do with the code under test.
- A test that depends on DNS resolution, an open port, or another test's
  server still being up, with no explicit setup/teardown tying its lifecycle
  to the test.

## Severity guidance

A flaky pattern in a test guarding CRITICAL production logic is itself a
serious finding — an intermittently-skipped safety net is close to no safety
net. A flaky pattern in a low-stakes test is still worth naming, since flake
compounds: each one adds to how often the whole suite needs a re-run before
anyone trusts a red build.`,
  },
];

/**
 * Public search over the catalog — drops `body` (never sent in a list
 * response). `q` substring-matches `name` or `desc` case-insensitively; `lang`
 * exact-matches case-insensitively; when both are given they AND together;
 * with neither, every entry is returned.
 */
export function searchCommunitySkills(q?: string, lang?: string): CommunitySkill[] {
  const needle = q?.toLowerCase();
  const wantLang = lang?.toLowerCase();

  return COMMUNITY_SKILLS.filter((entry) => {
    const matchesQuery = needle
      ? entry.name.toLowerCase().includes(needle) || entry.desc.toLowerCase().includes(needle)
      : true;
    const matchesLang = wantLang ? entry.lang.toLowerCase() === wantLang : true;
    return matchesQuery && matchesLang;
  }).map(({ body: _body, ...publicFields }) => publicFields);
}

/** Full internal entry (including `body`) whose `repo` equals `id`, for import. */
export function getCommunitySkillBody(id: string): CommunitySkillEntry | undefined {
  return COMMUNITY_SKILLS.find((entry) => entry.repo === id);
}
