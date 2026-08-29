/**
 * T17 — Export-to-CI's R9/R10 security sweep. HERMETIC (no DB, no Docker,
 * never imports `test/helpers/pg.ts`):
 *
 *  (a) AC-52/AC-53 — no generated file and no API response body ever matches
 *      a secret-shaped pattern, on the SUCCESS path (preview/archive, whose
 *      `CiService` methods never touch `this.repo` and so can be reached
 *      hermetically through a real `buildApp()` route call with just
 *      `agentsRepo`/`ciRunnerBundle` overridden — same pattern
 *      `test/project-context-routes.test.ts` uses) and the FAILURE path (a
 *      GitHub API error carrying a real-shaped token, proven at the
 *      `CiService` level with an injected `CiRepositoryLike` fake — the same
 *      "optional injectable repo" seam `service.test.ts` already exercises
 *      for AC-32/AC-53, reused here for a full 3-pattern sweep instead of one
 *      substring check).
 *  (b) AC-54 — the generated workflow's runner invocation is EXACTLY
 *      `node .devdigest/runner/index.js`, with an env-key allowlist proving
 *      no flag/env var can disable grounding or substitute the prompt.
 *  (c) AC-55 (the "approve everything" adversarial PR body still yields the
 *      grounded, deterministic gate outcome) is covered by
 *      `agent-runner/src/run.test.ts`, not here — this module has no access
 *      to a live LLM call to drive that scenario against.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import type { CiExportInput, CiPreview } from '@devdigest/shared';
import type { AgentRow, SkillRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import type { AgentsRepository } from '../agents/repository.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider, MockGitHubClient, MockCiRunnerBundle } from '../../adapters/mocks.js';
import { toAgentDto } from '../agents/helpers.js';
import { toSkillDto } from '../skills/helpers.js';
import { buildBundle } from './bundle.js';
import { renderWorkflow } from './workflow.js';
import { CiService, type CiRepositoryLike } from './service.js';
import { RUNNER_PATH } from './constants.js';

// ---------------------------------------------------------------------------
// The three patterns the sweep must never find a match for, plus a
// literal fixture token used ONLY in the failure-path scenario below (a
// GH-token-shaped credential that a real GitHub API error message could
// plausibly carry — proving `CiService.wrapGithubError`'s redaction strips it
// before it ever reaches a response body).
// ---------------------------------------------------------------------------
const GHP_PATTERN = /gh[ps]_[A-Za-z0-9]{36,}/;
const SK_PATTERN = /sk-[A-Za-z0-9]{20,}/;
const FIXTURE_TOKEN = `ghp_${'F'.repeat(36)}`;

function assertNoSecretLeak(haystack: string): void {
  expect(haystack).not.toMatch(GHP_PATTERN);
  expect(haystack).not.toMatch(SK_PATTERN);
  expect(haystack).not.toContain(FIXTURE_TOKEN);
}

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const AUTH = new MockAuthProvider(
  { id: 'u1', email: 'you@local', name: 'You' },
  { id: 'ws-1', name: 'default' },
);

const AGENT_ID = '11111111-1111-1111-1111-111111111111';
const RUNNER_SOURCE = '// bundled agent-runner CLI\nconsole.log("mock runner");\n';

function makeAgentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: AGENT_ID,
    workspaceId: 'ws-1',
    name: 'Security Reviewer',
    description: 'Flags secrets and injection risks',
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    systemPrompt: 'You are a careful, security-minded reviewer. Be concise and cite evidence.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as AgentRow;
}

function makeSkillRow(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'Security Baseline',
    description: '',
    type: 'security',
    source: 'manual',
    body: '# Security Baseline\nNever hardcode credentials. Flag any that appear in a diff.',
    enabled: true,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as SkillRow;
}

function makeInput(overrides: Partial<CiExportInput> = {}): CiExportInput {
  return {
    repo: 'acme/widgets',
    target: 'gha',
    action: 'open_pr',
    post_as: 'github_review',
    triggers: ['opened', 'synchronize', 'reopened'],
    base: 'main',
    workflow_override: null,
    ...overrides,
  };
}

function agentsRepoOverride(row: AgentRow, skills: { skill: SkillRow; order: number }[] = []) {
  return {
    getById: async (_workspaceId: string, id: string) => (row.id === id ? row : undefined),
    linkedSkills: async (_agentId: string) => skills,
  } as unknown as AgentsRepository;
}

// ---------------------------------------------------------------------------
// (a) Secret sweep — success path
// ---------------------------------------------------------------------------

describe('R9/R10 secret sweep — success path', () => {
  it('buildBundle output (every generated file) matches none of the three secret patterns', () => {
    const agent = toAgentDto(makeAgentRow());
    const skill = toSkillDto(makeSkillRow());

    const files = buildBundle({
      agent,
      skills: [skill],
      runnerSource: RUNNER_SOURCE,
      input: { triggers: ['opened', 'synchronize', 'reopened'], post_as: 'github_review' },
    });

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      assertNoSecretLeak(file.path);
      assertNoSecretLeak(file.contents);
    }
  });

  it('POST /agents/:id/ci-preview response body matches none of the three secret patterns (no DB touched — AC-13)', async () => {
    const app = await buildApp({
      config,
      overrides: {
        auth: AUTH,
        agentsRepo: agentsRepoOverride(makeAgentRow(), [{ skill: makeSkillRow(), order: 0 }]),
        ciRunnerBundle: new MockCiRunnerBundle(RUNNER_SOURCE),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/ci-preview`,
      payload: makeInput(),
    });

    expect(res.statusCode).toBe(200);
    assertNoSecretLeak(res.body);
    const preview = res.json() as CiPreview;
    for (const file of preview.files) assertNoSecretLeak(file.contents);

    await app.close();
  });

  it('POST /agents/:id/ci-archive response body matches none of the three secret patterns (no DB, no GitHub call — AC-30)', async () => {
    const app = await buildApp({
      config,
      overrides: {
        auth: AUTH,
        agentsRepo: agentsRepoOverride(makeAgentRow(), [{ skill: makeSkillRow(), order: 0 }]),
        ciRunnerBundle: new MockCiRunnerBundle(RUNNER_SOURCE),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/ci-archive`,
      payload: makeInput(),
    });

    expect(res.statusCode).toBe(200);
    // The zip is base64 — sweep the encoded body too (a plaintext secret would
    // still show up as a literal ASCII substring of its base64 encoding only
    // by coincidence, but the response envelope itself, e.g. `filename`, and
    // the request/response JSON as a whole must never carry the raw patterns).
    assertNoSecretLeak(res.body);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// (a) Secret sweep — failure path (a rejecting GitHub client)
// ---------------------------------------------------------------------------

describe('R9/R10 secret sweep — failure path (GitHub rejects the export)', () => {
  class LeakyGitHubClient extends MockGitHubClient {
    async commitFiles(): Promise<{ branch: string }> {
      throw new Error(`403 Forbidden: bad credentials ${FIXTURE_TOKEN}`);
    }
  }

  /** Minimal `CiRepositoryLike` — `exportToCi`'s conflict check is the only
   *  repo call reached before the (rejecting) GitHub call; nothing else is
   *  exercised on this path. */
  class NoConflictRepo implements CiRepositoryLike {
    async findInstallationByRepo() {
      return undefined;
    }
    async upsertInstallation(): Promise<never> {
      throw new Error('must not be reached: GitHub rejects before any write');
    }
    async listInstallations() {
      return [];
    }
  }

  function makeContainer(): Container {
    const github = new LeakyGitHubClient();
    return {
      agentsRepo: agentsRepoOverride(makeAgentRow()),
      ciRunnerBundle: { read: async () => RUNNER_SOURCE },
      github: async () => github,
    } as unknown as Container;
  }

  it('the thrown error (the same message app.ts serializes into the API error response body) never carries the raw fixture token or a generically-shaped secret (AC-53)', async () => {
    const service = new CiService(makeContainer(), new NoConflictRepo());

    let caught: unknown;
    try {
      await service.exportToCi('ws-1', AGENT_ID, makeInput());
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    const message = (caught as Error).message;
    // Sanity: the underlying leak actually happened — otherwise this test
    // would pass vacuously regardless of whether redaction works.
    expect(message).toContain('bad credentials');
    assertNoSecretLeak(message);

    // `app.ts`'s global error handler maps an `AppError` straight to
    // `{ error: { code, message: err.message, details } }` — no other field
    // of the thrown error is ever serialized into the response — so a clean
    // `message` here is equivalent to a clean HTTP response body. The route
    // itself cannot be driven the same way in a HERMETIC file: `exportToCi`'s
    // conflict check hits the real, DB-backed `CiRepository` (no override
    // slot for it, server/insights/INSIGHTS.md 2026-08-27) before GitHub is
    // ever called, so a real `app.inject()` call here would require Docker —
    // exactly the "GET/POST /ci-runs* … needs .it.test.ts" gotcha, extended
    // to this route's non-validation-error path.
  });
});

// ---------------------------------------------------------------------------
// (b) AC-54 — the runner invocation is exactly `node .devdigest/runner/index.js`
// ---------------------------------------------------------------------------

describe('AC-54: the generated workflow never bypasses grounding via the runner invocation', () => {
  /** Every env var the generated "Run DevDigest review" step is allowed to
   *  set. None of these can disable grounding or substitute the prompt — they
   *  are a credential-by-name, repo/PR identity, and the post-destination
   *  choice (`workflow.ts`'s own doc comment: "Secret NAMES only (AC-52)"). */
  const ALLOWED_ENV_KEYS = new Set([
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'PR_NUMBER',
    'DEVDIGEST_POST_AS',
  ]);

  function reviewStep(yamlText: string): { run: string; env: Record<string, string> } {
    const doc = parse(yamlText) as {
      jobs: { review: { steps: { name?: string; run?: string; env?: Record<string, string> }[] } };
    };
    const step = doc.jobs.review.steps.find((s) => s.name === 'Run DevDigest review');
    if (!step || typeof step.run !== 'string' || !step.env) {
      throw new Error('expected a "Run DevDigest review" step with run + env');
    }
    return { run: step.run, env: step.env };
  }

  it('the run command is EXACTLY "node .devdigest/runner/index.js" — single exact string match, no flags', () => {
    const yamlText = renderWorkflow({
      triggers: ['opened', 'synchronize', 'reopened'],
      postAs: 'github_review',
    });
    const { run } = reviewStep(yamlText);

    expect(run).toBe('node .devdigest/runner/index.js');
    expect(run).toBe(`node ${RUNNER_PATH}`);
  });

  it('holds for every post_as destination — no destination-specific flag is ever appended to the run command', () => {
    for (const postAs of ['github_review', 'pr_comment', 'none'] as const) {
      const yamlText = renderWorkflow({ triggers: ['opened'], postAs });
      const { run, env } = reviewStep(yamlText);

      expect(run).toBe('node .devdigest/runner/index.js');
      // Only the allowlisted env keys are ever set — no
      // grounding-disabling/prompt-substituting variable name exists.
      for (const key of Object.keys(env)) {
        expect(ALLOWED_ENV_KEYS.has(key)).toBe(true);
      }
    }
  });

  it('no environment value or the run command itself contains a grounding-disabling or prompt-substituting flag', () => {
    const yamlText = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    const { run, env } = reviewStep(yamlText);
    const DANGEROUS = /--no-ground|--skip-ground|--no-guard|--system-prompt|--prompt|SYSTEM_PROMPT_OVERRIDE|DISABLE_GROUNDING|SKIP_GROUNDING/i;

    expect(run).not.toMatch(DANGEROUS);
    for (const value of Object.values(env)) {
      expect(value).not.toMatch(DANGEROUS);
    }
  });
});
