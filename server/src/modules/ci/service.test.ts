/**
 * `CiService` (T10) — hermetic, no DB, no Docker.
 *
 * `container.agentsRepo`/`container.ciRunnerBundle`/`container.github()` are
 * hand-built fakes cast `as unknown as Container` (same pattern as
 * `test/onboarding-service.test.ts`). `CiRepository` is never constructed
 * for real: `CiService` takes it as an optional second constructor argument
 * (`CiRepositoryLike`, a `Pick<>` of the three methods this service calls),
 * so every test injects an in-memory `FakeCiRepository` with no cast needed.
 */
import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import type { CiExportInput, CiInstallation, GitHubClient } from '@devdigest/shared';
import type { AgentRow, SkillRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import { CiService, type CiRepositoryLike } from './service.js';
import type { CiInstallationWithStatus, UpsertInstallationInput } from './repository.js';
import { WORKFLOW_PATH } from './constants.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUNNER_SOURCE = '// bundled runner\nconsole.log("hi");\n';

function makeAgentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Security Reviewer',
    description: 'Flags secrets and injection risks',
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    systemPrompt: 'You are a careful security reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'warning',
    repoIntel: true,
    enabled: true,
    version: 3,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as AgentRow;
}

function makeSkillRow(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'Security',
    description: '',
    type: 'security',
    source: 'manual',
    body: '# Security\nCheck for secrets.',
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

interface ContainerOpts {
  agentRow?: AgentRow | undefined;
  linkedSkills?: { skill: SkillRow; order: number }[];
  runnerSource?: string;
  github?: GitHubClient;
}

/** `undefined` agentRow means "no such agent" (`getById` resolves `undefined`). */
function makeContainer(opts: ContainerOpts = {}): Container {
  const agentRow = 'agentRow' in opts ? opts.agentRow : makeAgentRow();
  const github = opts.github ?? new MockGitHubClient();
  return {
    agentsRepo: {
      getById: async (_workspaceId: string, id: string) =>
        agentRow && agentRow.id === id ? agentRow : undefined,
      linkedSkills: async (_agentId: string) => opts.linkedSkills ?? [],
    },
    ciRunnerBundle: { read: async () => opts.runnerSource ?? RUNNER_SOURCE },
    github: async () => github,
  } as unknown as Container;
}

/** In-memory stand-in for `CiRepository` — matches `CiRepositoryLike`'s three methods. */
class FakeCiRepository implements CiRepositoryLike {
  installations: CiInstallation[] = [];
  upsertCalls: UpsertInstallationInput[] = [];
  /** Lets a test simulate "the agent's CURRENT version moved on" independently
   *  of what an installation row recorded at export time. */
  agentVersions = new Map<string, number>();

  async findInstallationByRepo(_workspaceId: string, repo: string): Promise<CiInstallation | undefined> {
    return this.installations.find((i) => i.repo === repo);
  }

  async upsertInstallation(input: UpsertInstallationInput): Promise<CiInstallation> {
    this.upsertCalls.push(input);
    const installation: CiInstallation = {
      id:
        this.installations.find((i) => i.agent_id === input.agentId && i.repo === input.repo)?.id ??
        `inst-${this.installations.length + 1}`,
      agent_id: input.agentId,
      repo: input.repo,
      target_type: input.targetType,
      installed_at: new Date().toISOString(),
      agent_version: input.agentVersion,
      base_branch: input.baseBranch,
      post_as: input.postAs,
      triggers: input.triggers,
    };
    const idx = this.installations.findIndex((i) => i.agent_id === input.agentId && i.repo === input.repo);
    if (idx >= 0) this.installations[idx] = installation;
    else this.installations.push(installation);
    return installation;
  }

  async listInstallations(_workspaceId: string, agentId?: string): Promise<CiInstallationWithStatus[]> {
    return this.installations
      .filter((i) => !agentId || i.agent_id === agentId)
      .map((i) => ({
        installation: i,
        agentCurrentVersion: this.agentVersions.get(i.agent_id) ?? i.agent_version,
        lastRun: null,
      }));
  }
}

/** A `MockGitHubClient` whose `commitFiles` rejects — for the AC-32/AC-53
 *  "rejecting client" tests. A local subclass, not an edit to `mocks.ts`. */
class ThrowingGitHubClient extends MockGitHubClient {
  async commitFiles(): Promise<{ branch: string }> {
    throw new Error('403 Forbidden: bad credentials ghp_abcdefghijklmnopqrstuvwxyz012345');
  }
}

/** Awaits `fn`, returning the thrown value — fails the test if `fn` resolves. */
async function captureError(fn: () => Promise<unknown>): Promise<{ statusCode?: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    return err as { statusCode?: number; message: string };
  }
  throw new Error('expected the call to throw');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CiService', () => {
  it('rejects target "jenkins" with a 4xx error naming the target, before any GitHub call or write (AC-12)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);
    const input = makeInput({ target: 'jenkins' });

    for (const call of [
      () => service.preview('ws-1', 'agent-1', input),
      () => service.exportToCi('ws-1', 'agent-1', input),
      () => service.archive('ws-1', 'agent-1', input),
    ]) {
      const err = await captureError(call);
      expect(err.statusCode).toBeGreaterThanOrEqual(400);
      expect(err.statusCode!).toBeLessThan(500);
      expect(err.message).toContain('jenkins');
    }

    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    expect(repo.upsertCalls).toHaveLength(0);
  });

  it('preview makes zero GitHub calls and writes zero installation rows (AC-13)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);

    const result = await service.preview('ws-1', 'agent-1', makeInput());

    expect(result.files.length).toBeGreaterThan(0);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
    expect(repo.upsertCalls).toHaveLength(0);
  });

  it('preview and export produce byte-identical file contents for the same input (AC-19)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);
    const input = makeInput();

    const previewResult = await service.preview('ws-1', 'agent-1', input);
    const exportResult = await service.exportToCi('ws-1', 'agent-1', input);

    expect(exportResult.files).toEqual(previewResult.files);
  });

  it('export commits exactly the bundle paths and returns a non-null pr_url (AC-26)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);

    const result = await service.exportToCi('ws-1', 'agent-1', makeInput());

    expect(result.pr_url).not.toBeNull();
    expect(github.committed).toHaveLength(1);
    const committedPaths = github.committed[0]!.files.map((f) => f.path).sort();
    const bundlePaths = result.files.map((f) => f.path).sort();
    expect(committedPaths).toEqual(bundlePaths);
  });

  it('a second export reuses the open PR and opens no new one (AC-27)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);
    const input = makeInput();

    const first = await service.exportToCi('ws-1', 'agent-1', input);
    expect(github.openedPrs).toHaveLength(1);

    const second = await service.exportToCi('ws-1', 'agent-1', input);

    expect(second.pr_url).toBe(first.pr_url);
    expect(github.openedPrs).toHaveLength(1);
  });

  it("persists the installation with the agent's current version (AC-28, AC-50)", async () => {
    const agentRow = makeAgentRow({ version: 7 });
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github, agentRow }), repo);

    const result = await service.exportToCi('ws-1', 'agent-1', makeInput());

    expect(result.installation.agent_version).toBe(7);
    expect(repo.upsertCalls).toHaveLength(1);
    expect(repo.upsertCalls[0]!.agentVersion).toBe(7);
  });

  it('archive returns a zip matching the bundle paths with zero GitHub calls (AC-30)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);

    const previewResult = await service.preview('ws-1', 'agent-1', makeInput());
    const archiveResult = await service.archive('ws-1', 'agent-1', makeInput());

    const zipBytes = new Uint8Array(Buffer.from(archiveResult.content_base64, 'base64'));
    const entries = unzipSync(zipBytes);
    expect(Object.keys(entries).sort()).toEqual(previewResult.files.map((f) => f.path).sort());
    expect(archiveResult.filename).toMatch(/\.zip$/);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
  });

  it('archive writes no installation row; confirmInstallation does (AC-31)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);

    await service.archive('ws-1', 'agent-1', makeInput());
    expect(repo.upsertCalls).toHaveLength(0);

    const installation = await service.confirmInstallation('ws-1', 'agent-1', {
      repo: 'acme/widgets',
      target: 'gha',
      base: 'main',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize', 'reopened'],
    });

    expect(repo.upsertCalls).toHaveLength(1);
    expect(installation.repo).toBe('acme/widgets');
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
  });

  it('a rejecting GitHub client surfaces the repo + reason, no token substring, and persists nothing (AC-32, AC-53)', async () => {
    const github = new ThrowingGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);

    const err = await captureError(() => service.exportToCi('ws-1', 'agent-1', makeInput()));

    expect(err.message).toContain('acme/widgets');
    expect(err.message).toContain('bad credentials');
    expect(err.message).not.toMatch(/ghp_[A-Za-z0-9]{10,}/);
    expect(repo.upsertCalls).toHaveLength(0);
  });

  it('applies a workflow_override for one export only; a follow-up export regenerates the original (AC-56)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);
    const override = 'name: Custom\non:\n  pull_request:\n    types: [opened]\n';

    const first = await service.exportToCi('ws-1', 'agent-1', makeInput({ workflow_override: override }));
    const overriddenFile = first.files.find((f) => f.path === WORKFLOW_PATH)!;
    expect(overriddenFile.contents).toBe(override);
    const committedOverride = github.committed[0]!.files.find((f) => f.path === WORKFLOW_PATH)!;
    expect(committedOverride.contents).toBe(override);

    const second = await service.exportToCi('ws-1', 'agent-1', makeInput());
    const regeneratedFile = second.files.find((f) => f.path === WORKFLOW_PATH)!;
    expect(regeneratedFile.contents).not.toBe(override);
  });

  it('an invalid workflow_override throws before any GitHub call is recorded (AC-57)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const service = new CiService(makeContainer({ github }), repo);
    const input = makeInput({ workflow_override: 'a:\n - b\n  c:' });

    await expect(service.exportToCi('ws-1', 'agent-1', input)).rejects.toThrow();

    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
  });

  it('reports out_of_date once the agent version bumps, leaving the installation row untouched (AC-8)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    const agentRow = makeAgentRow({ version: 3 });
    const service = new CiService(makeContainer({ github, agentRow }), repo);

    const exported = await service.exportToCi('ws-1', 'agent-1', makeInput());
    expect(exported.installation.agent_version).toBe(3);

    repo.agentVersions.set('agent-1', 5);
    const statuses = await service.installationStatuses('ws-1', 'agent-1');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.out_of_date).toBe(true);
    expect(statuses[0]!.installation.agent_version).toBe(3);
  });

  it.each(['../user', 'owner/..', './x'])(
    'rejects a repo shape with a dot-only segment ("%s") with a 4xx and zero GitHub calls',
    async (repo) => {
      const github = new MockGitHubClient();
      const ciRepo = new FakeCiRepository();
      const service = new CiService(makeContainer({ github }), ciRepo);
      const input = makeInput({ repo });

      for (const call of [
        () => service.preview('ws-1', 'agent-1', input),
        () => service.exportToCi('ws-1', 'agent-1', input),
        () => service.archive('ws-1', 'agent-1', input),
      ]) {
        const err = await captureError(call);
        expect(err.statusCode).toBeGreaterThanOrEqual(400);
        expect(err.statusCode!).toBeLessThan(500);
      }

      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
      expect(ciRepo.upsertCalls).toHaveLength(0);
    },
  );

  it('refuses an export when the repo is already installed by a different agent (A4)', async () => {
    const github = new MockGitHubClient();
    const repo = new FakeCiRepository();
    repo.installations.push({
      id: 'inst-existing',
      agent_id: 'other-agent',
      repo: 'acme/widgets',
      target_type: 'gha',
      installed_at: new Date().toISOString(),
      agent_version: 1,
      base_branch: 'main',
      post_as: 'github_review',
      triggers: ['opened'],
    });
    const service = new CiService(makeContainer({ github }), repo);

    const err = await captureError(() => service.exportToCi('ws-1', 'agent-1', makeInput()));

    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('other-agent');
    expect(github.committed).toHaveLength(0);
    expect(repo.upsertCalls).toHaveLength(0);
  });
});
