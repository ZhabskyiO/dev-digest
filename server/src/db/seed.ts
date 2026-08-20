import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { Onboarding, type Onboarding as OnboardingT } from '@devdigest/shared';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, three seeded skills (uncovered-branch-gate,
 * corner-case-checklist, mock-overuse), and the four built-in agents (General +
 * Security + Performance + Test Quality), all on the default
 * openrouter/deepseek-v4-flash provider+model. The Test Quality Reviewer is
 * linked to its three seeded skills, in order; its fourth skill
 * (flaky-test-patterns) ships via the community catalog instead, not the seed.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …) once
 * their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- onboarding tour (demo repo, read-only browser flow fixture) ----
  // Inserted directly against `t.onboarding` — the module's repository
  // (`OnboardingRepository`, the only OTHER file allowed to touch this
  // table) intentionally reads/writes `json` as `unknown` and never
  // Onboarding.parse()s it, so it can't be reused here as the validation
  // step this task requires. `Onboarding.parse()` below is that check: a
  // payload that doesn't parse cleanly makes the stored row the "legacy row"
  // edge case (service.ts / repository.ts doc comment) and the read path
  // silently treats it as absent, so the browser flow (T14) would see an
  // empty state instead of a tour with no error anywhere.
  //
  // Deliberately NO `repo_index_state` row for this repo (see T13's task
  // brief): a stored tour is served regardless of index state, and seeding
  // one would make every other repo-intel consumer believe this demo repo is
  // indexed while its symbol tables are actually empty.
  const onboardingPayload: OnboardingT = {
    sections: [
      {
        kind: 'architecture',
        title: 'Architecture overview',
        body:
          '**payments-api** is a Node + TypeScript service fronting Stripe. Requests enter ' +
          'through `src/server.ts`, pass middleware (auth, rate-limit), and route to ' +
          '`src/api/public/*`. Persistence is Postgres via a thin `db` client; Redis backs ' +
          'sessions and the new rate-limit buckets.',
        diagram: `flowchart LR
  client[client] --> server[src/server.ts]
  server --> middleware[middleware]
  server --> api["src/api/public/*"]
  middleware --> redis[(redis)]
  api --> postgres[(postgres)]`,
        links: null,
      },
      {
        kind: 'critical_paths',
        title: 'Critical paths',
        items: [
          { path: 'src/server.ts', why: 'App bootstrap + middleware chain' },
          {
            path: 'src/api/public/index.ts',
            why: 'Public router — unauthenticated surface',
          },
          { path: 'src/middleware/auth.ts', why: 'Token validation, used by 14 routes' },
          { path: 'src/lib/redis.ts', why: 'Shared Redis singleton — reuse this' },
        ],
        diagram: null,
        links: null,
      },
      {
        kind: 'routes_and_apis',
        title: 'Routes & APIs',
        diagram: null,
        items: [
          {
            surface: 'frontend',
            group: 'Admin Dashboard',
            method: null,
            route: '/dashboard',
            source_path: 'src/frontend/dashboard/index.tsx',
            note: 'Static admin UI for recent charges and webhook activity',
          },
          {
            surface: 'api',
            group: 'Public API',
            method: 'POST',
            route: '/public/webhooks',
            source_path: 'src/api/public/webhooks.ts',
            note: 'Stripe webhook receiver, signature-verified',
          },
          {
            surface: 'api',
            group: 'Payments',
            method: 'POST',
            route: '/payments/charges',
            source_path: 'src/api/payments/charges.ts',
            note: 'Creates a Stripe charge; behind auth middleware',
          },
          {
            surface: 'api',
            group: 'Payments',
            method: 'GET',
            route: '/payments/charges/:id',
            source_path: 'src/api/payments/charges.ts',
            note: null,
          },
          {
            surface: 'api',
            group: 'Users',
            method: 'GET',
            route: '/users',
            source_path: 'src/api/users.ts',
            note: 'Rate-limited list endpoint',
          },
        ],
        links: null,
      },
      {
        kind: 'local_setup',
        title: 'How to run locally',
        items: [
          { command: 'pnpm install' },
          { command: 'cp .env.example .env # add OPENAI + STRIPE keys' },
          { command: 'docker compose up -d postgres redis' },
          { command: 'pnpm dev # http://localhost:3000' },
        ],
        diagram: null,
        links: null,
      },
      {
        kind: 'reading_path',
        title: 'Guided reading path',
        items: [
          {
            path: 'src/server.ts',
            rationale: 'See the whole request lifecycle in one file',
          },
          {
            path: 'src/api/public/index.ts',
            rationale: 'Understand the public contract before touching it',
          },
          {
            path: 'src/middleware/auth.ts',
            rationale: 'Auth touches almost everything downstream',
          },
        ],
        diagram: null,
        links: null,
      },
      {
        kind: 'first_tasks',
        title: 'First tasks',
        items: [
          {
            title: 'Add a /health readiness probe',
            target: 'src/api/public/health.ts',
            complexity: 'low',
          },
          {
            title: 'Backfill tests for the rate limiter',
            target: 'test/ratelimit.test.ts',
            complexity: 'medium',
          },
          {
            title: 'Document the webhook signature flow',
            target: 'specs/',
            complexity: 'low',
          },
        ],
        diagram: null,
        links: null,
      },
    ],
    generated_at: '2026-08-18T10:00:00.000Z',
    indexed_revision: 'f3a9c7d1e8b4025619bc9a4e7f18cd2b6a0d3e5',
    indexed_file_count: 12450,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
  };
  // Validate in the seed, not by eye — see the doc comment above.
  const validatedOnboarding = Onboarding.parse(onboardingPayload);

  const [existingOnboarding] = await db
    .select({ repoId: t.onboarding.repoId })
    .from(t.onboarding)
    .where(eq(t.onboarding.repoId, repoId));
  if (!existingOnboarding) {
    await db.insert(t.onboarding).values({
      repoId,
      json: validatedOnboarding,
      generatedAt: new Date(validatedOnboarding.generated_at),
    });
  }

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in skills (L02: Test Quality Reviewer's rubrics) ----
  // Bodies are directive markdown instructions (skills are read as trusted
  // instructions once enabled) — see server/insights/INSIGHTS.md for why these are
  // inserted directly against `t.skills` rather than via SkillsRepository.insert
  // (that call also writes a `skill_versions` row; seeded rows deliberately don't
  // get one, matching how seedAgents bypasses AgentsRepository).
  //
  // This is 3 of the 4 skills the Test Quality Reviewer uses. The 4th,
  // `flaky-test-patterns`, ships via the community catalog
  // (`modules/skills/community-catalog.ts`) instead of the DB seed, so the
  // manual walkthrough exercises the import → lands disabled → gets vetted →
  // enabled path.
  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'uncovered-branch-gate',
      description: 'Catches branches and conditionals introduced by a diff with no covering test.',
      type: 'rubric',
      source: 'manual',
      body: `# Uncovered Branch Gate

For every branch, conditional, or early return that this diff adds or changes,
confirm the diff's tests actually exercise it. A branch nobody tests is a branch
nobody has verified.

## What to check

- For each \`if\`/\`else\`/\`switch\`/ternary/\`??\`/\`||\` added or modified by the
  diff, find the test case that takes the OTHER path too. An \`if\` with only its
  happy-path branch tested is half-covered.
- For each early return or guard clause, confirm there is a test that actually
  triggers it — not just a test that happens to satisfy the guard on the way to
  the main path.
- For each \`catch\` block or \`.catch()\` handler introduced by the diff, confirm a
  test drives the error path, not just the success path.
- For loops with a zero-iteration case (empty array, no matches), confirm that
  case is exercised, not just the \"has items\" case.
- When a function gains a new parameter that changes control flow, confirm both
  the old default behavior and the new behavior are each covered by a test.

## How to decide severity

Weigh how much a bug in the uncovered branch could actually cost — flip the
branch's condition mentally and ask whether any test in the diff would fail. If
none would, that branch is uncovered no matter how "obviously correct" it looks.
Untested branches in low-stakes, low-complexity code are a minor note, not a
blocker; untested branches that guard risky behavior (data writes, authorization,
money, error handling that could fail open) deserve your most serious severity.

## What NOT to flag

- Branches that existed before this diff and are unchanged by it.
- Branches inside code paths that are unreachable given the diff's own guards
  (don't demand a test for something that cannot happen).
- Purely defensive branches with no realistic path to exercise them (e.g. a
  \`should be impossible\` \`throw\` guarding a truly exhaustive \`switch\`).`,
      enabled: true,
    },
    {
      workspaceId,
      name: 'corner-case-checklist',
      description: 'Catches missing empty/null/boundary/error-path test cases.',
      type: 'rubric',
      source: 'manual',
      body: `# Corner Case Checklist

For any new or changed logic in this diff that accepts input, iterates a
collection, or crosses a boundary, check whether the diff's tests cover the
corner cases below. Only apply the ones that are actually reachable for the
code under review — don't demand a null check on a value the type system
already rules out.

## Empty / absent input

- An empty array, empty string, empty object, or empty result set — not just
  the "has one or more items" case.
- \`null\` / \`undefined\` for any parameter, field, or external response that is
  not statically guaranteed to be present.
- A missing/optional field in a request body, DB row, or API response that the
  new code reads.

## Boundary values

- The first and last element of a collection; index 0; the exact edge of a
  \`limit\`/\`offset\`/pagination window (0 items, exactly the page size, one over).
- Numeric boundaries: 0, negative numbers where only positive is expected,
  the maximum allowed value, off-by-one around any \`<\` vs \`<=\` comparison.
- String boundaries: empty string, whitespace-only, exactly at a length limit.

## Error / failure paths

- A dependency (DB call, external API, filesystem op) that rejects or throws —
  does a test confirm the new code's error handling actually runs and behaves
  correctly, not just that the happy path works?
- Partial failure in a batch or multi-step operation: what happens to the
  already-completed steps when a later step fails?
- Invalid/malformed input that should be rejected — confirm a test asserts the
  rejection, not just that valid input is accepted.

## Severity guidance

A missing corner case that could produce silently wrong output, a crash, or
data corruption in production deserves your highest severity. A missing corner
case that would just be an obviously-visible failure (e.g. a 500 on bad input
in an internal admin tool) is a lower priority — name it, but don't overstate it.`,
      enabled: true,
    },
    {
      workspaceId,
      name: 'mock-overuse',
      description: 'Catches over-mocking, mocking code the PR itself owns, and tests that verify mocks instead of behavior.',
      type: 'convention',
      source: 'manual',
      body: `# Mock Overuse

Mocks exist to remove things outside this codebase's control from a test (a
network call, the system clock, a third-party SDK). Flag mocking that goes
beyond that and ends up testing the mock instead of the real behavior.

## Flag when the diff's tests do this

- **Mocking a function or module the PR itself defines or changes.** If the test
  mocks out the exact logic under test, a passing test proves nothing about
  whether that logic is correct — only that the mock returns what the test told
  it to return.
- **Mocking so much of a collaborator that the test no longer exercises any real
  integration.** If every dependency of the unit under test is mocked, the test
  is really asserting "my mocks were called with the arguments I expected,"
  which passes even if the real collaborators would reject that call.
- **Asserting on mock call arguments instead of on observable outcomes.**
  \`expect(mockFn).toHaveBeenCalledWith(x)\` is a weaker claim than asserting the
  actual result, response, or side effect the caller cares about — prefer the
  latter, and treat the former as the whole assertion as a smell.
- **Re-implementing the mocked function's logic inside the mock**, so the mock
  quietly becomes a second implementation that can drift from the real one
  without either test noticing.
- **Mocking at too coarse a boundary** when a narrower one (a single adapter
  call, one HTTP client) would let more of the PR's own logic run for real.

## What's fine — don't flag this

- Mocking genuinely external systems: LLM providers, GitHub's API, git/ripgrep
  subprocesses, the system clock, randomness sources. This codebase's own
  \`adapters/mocks.ts\` fakes exist for exactly this reason.
- Using a real Postgres via testcontainers instead of mocking the DB layer —
  that is the stronger choice, not a violation.
- A thin stub for a slow/expensive dependency in a unit test, as long as the
  logic under test is not itself what's being stubbed.

## Severity guidance

Mocking the exact code under test so the test cannot fail regardless of a real
bug is a serious finding — the test suite is giving false confidence. Weaker
assertions or a coarser-than-ideal mock boundary are worth a lighter-weight note.`,
      enabled: true,
    },
  ];
  const skillIdByName = new Map<string, string>();
  for (const s of seedSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      skillIdByName.set(existing.name, existing.id);
    } else {
      const [inserted] = await db.insert(t.skills).values(s).returning();
      skillIdByName.set(inserted!.name, inserted!.id);
    }
  }

  // ---- built-in agents (the four starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Reviews test changes for coverage gaps, missing corner cases, and test smells.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  const agentIdByName = new Map<string, string>();
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (existing) {
      agentIdByName.set(existing.name, existing.id);
    } else {
      const [inserted] = await db.insert(t.agents).values(a).returning();
      agentIdByName.set(inserted!.name, inserted!.id);
    }
  }

  // ---- link the Test Quality Reviewer to its 3 seeded skills, in order ----
  const testQualityAgentId = agentIdByName.get('Test Quality Reviewer');
  const uncoveredBranchGateId = skillIdByName.get('uncovered-branch-gate');
  const cornerCaseChecklistId = skillIdByName.get('corner-case-checklist');
  const mockOveruseId = skillIdByName.get('mock-overuse');
  if (testQualityAgentId && uncoveredBranchGateId && cornerCaseChecklistId && mockOveruseId) {
    await db
      .insert(t.agentSkills)
      .values([
        { agentId: testQualityAgentId, skillId: uncoveredBranchGateId, order: 0 },
        { agentId: testQualityAgentId, skillId: cornerCaseChecklistId, order: 1 },
        { agentId: testQualityAgentId, skillId: mockOveruseId, order: 2 },
      ])
      .onConflictDoNothing();
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
