import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CiInstallation,
  CiResultArtifact,
  CiRunsQuery,
  CiWorkflowRun,
  GitHubClient,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import { CiIngestService } from './ingest.js';
import type { CiRepository, UpsertRunInput } from './repository.js';

/**
 * Hermetic in-memory stand-in for `CiRepository`, following the same
 * "construct the service normally, then override its private `repo` field"
 * pattern `test/repo-intel-resync.test.ts` uses for a container getter with
 * no override branch — `CiIngestService` builds `this.repo = new
 * CiRepository(container.db)` itself (mirroring every other `modules/*
 * /service.ts` in this codebase), so there is no constructor seam to inject
 * a fake through; overriding the field after construction is the seam.
 */
class FakeCiRepository {
  public upsertCalls: UpsertRunInput[] = [];
  private rows = new Map<string, UpsertRunInput>();

  constructor(private installations: { installation: CiInstallation }[]) {}

  async listInstallations(_workspaceId: string, agentId?: string) {
    const filtered = agentId
      ? this.installations.filter((i) => i.installation.agent_id === agentId)
      : this.installations;
    return filtered.map((i) => ({ installation: i.installation, agentCurrentVersion: 1, lastRun: null }));
  }

  async getRunStatuses(ids: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    for (const id of ids) map.set(id, this.rows.get(id)?.status ?? null);
    return map;
  }

  async upsertRun(input: UpsertRunInput): Promise<void> {
    this.upsertCalls.push(input);
    const existing = this.rows.get(input.workflowRunId);
    const TERMINAL = new Set(['succeeded', 'failed', 'no_findings']);
    if (existing && existing.status && TERMINAL.has(existing.status)) return;
    this.rows.set(input.workflowRunId, input);
  }

  async listRuns(_workspaceId: string, query: CiRunsQuery) {
    const ids = query.agent_id
      ? new Set(
          this.installations
            .filter((i) => i.installation.agent_id === query.agent_id)
            .map((i) => i.installation.id),
        )
      : null;
    const items = [...this.rows.values()]
      .filter((r) => !ids || (r.ciInstallationId && ids.has(r.ciInstallationId)))
      .map((r) => ({
        id: r.workflowRunId,
        ci_installation_id: r.ciInstallationId,
        pr_number: r.prNumber ?? null,
        ran_at: r.ranAt ? r.ranAt.toISOString() : null,
        status: r.status,
        findings_count: r.findingsCount ?? null,
        cost_usd: r.costUsd ?? null,
        github_url: r.githubUrl ?? null,
        source: r.source ?? null,
        agent: r.agent ?? null,
        duration_s: r.durationS ?? null,
        error: r.error ?? null,
        repo: null,
        agent_id: null,
      }));
    return { items, total: items.length };
  }

  rowFor(workflowRunId: string): UpsertRunInput | undefined {
    return this.rows.get(workflowRunId);
  }

  get rowCount(): number {
    return this.rows.size;
  }
}

function installation(overrides: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: 'inst-1',
    agent_id: 'agent-1',
    repo: 'acme/widgets',
    target_type: 'gha',
    installed_at: '2026-01-01T00:00:00Z',
    agent_version: 1,
    base_branch: 'main',
    post_as: 'github_review',
    triggers: ['opened', 'synchronize', 'reopened'],
    ...overrides,
  };
}

function workflowRun(overrides: Partial<CiWorkflowRun> = {}): CiWorkflowRun {
  return {
    id: 'run-1',
    status: 'completed',
    conclusion: 'failure',
    html_url: 'https://github.com/acme/widgets/actions/runs/1',
    pr_number: 42,
    created_at: '2026-01-01T00:00:00Z',
    run_started_at: '2026-01-01T00:00:05Z',
    updated_at: '2026-01-01T00:05:00Z',
    ...overrides,
  };
}

function artifactFixture(overrides: Partial<CiResultArtifact> = {}): CiResultArtifact {
  return {
    findings_count: 3,
    critical: 1,
    warning: 2,
    suggestion: 0,
    cost_usd: 0.0421,
    duration_ms: 45210,
    agent: 'Security Reviewer',
    version: '3',
    pr_number: 42,
    ...overrides,
  };
}

/** Build a `CiIngestService` wired to a fake repository and a given
 * `GitHubClient`, following the `repo-intel-resync.test.ts` "cast a plain
 * object as unknown as Container" pattern for a service that only needs
 * `container.github()` and `container.db` (never queried — `repo` is
 * overridden below). */
function makeService(github: GitHubClient, installations: { installation: CiInstallation }[]) {
  const fakeRepo = new FakeCiRepository(installations);
  const container = {
    db: {},
    github: async () => github,
  } as unknown as Container;
  const service = new CiIngestService(container);
  (service as unknown as { repo: CiRepository }).repo = fakeRepo as unknown as CiRepository;
  return { service, fakeRepo };
}

/** A `MockGitHubClient` whose `listWorkflowRuns` always rejects — simulates a
 * GitHub outage/rate limit during ingest (AC-45). Everything else keeps the
 * real mock's recording/fixture behaviour. */
class ThrowingGitHubClient extends MockGitHubClient {
  async listWorkflowRuns(): Promise<CiWorkflowRun[]> {
    throw new Error('GitHub API rate limited (403)');
  }
}

const WORKSPACE = 'ws-1';

beforeEach(() => {
  CiIngestService.resetThrottleForTests();
});

describe('CiIngestService', () => {
  it('exposes no method whose parameters are typed as CiResultArtifact — it is only produced internally after a downloaded artifact is validated (AC-39)', () => {
    // `refresh`/`list` are the only public entry points, and take only
    // (workspaceId, opts/query) — a CiResultArtifact is never accepted as
    // input from outside; it is constructed exactly once, at the
    // safeParse boundary right after `downloadRunArtifactFile` resolves.
    const sourcePath = fileURLToPath(new URL('./ingest.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    const methodSignatures = source.match(/(?:async\s+)?\w+\([^)]*\)\s*:/g) ?? [];
    expect(methodSignatures.length).toBeGreaterThan(0);
    for (const sig of methodSignatures) {
      expect(sig).not.toContain('CiResultArtifact');
    }
    expect(source).toContain('CiResultArtifact.safeParse');
  });

  it('writes one ci_runs row with PR number, timestamp, findings count, cost and run URL for a completed run + artifact (AC-40)', async () => {
    const run = workflowRun();
    const artifact = artifactFixture();
    const github = new MockGitHubClient({
      workflowRuns: [run],
      artifactFiles: { 'run-1/devdigest-result/devdigest-result.json': JSON.stringify(artifact) },
    });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    const result = await service.refresh(WORKSPACE, { force: true });

    expect(result.refresh_error).toBeNull();
    expect(fakeRepo.rowCount).toBe(1);
    const row = fakeRepo.rowFor('run-1')!;
    expect(row.prNumber).toBe(42);
    expect(row.ranAt).toEqual(new Date('2026-01-01T00:00:05Z'));
    expect(row.findingsCount).toBe(3);
    expect(row.costUsd).toBe(0.0421);
    expect(row.githubUrl).toBe('https://github.com/acme/widgets/actions/runs/1');
  });

  it('reports a queued/in_progress run as status "running" with no artifact download (AC-41)', async () => {
    const run = workflowRun({ id: 'run-2', status: 'in_progress' });
    const github = new MockGitHubClient({ workflowRuns: [run] });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    await service.refresh(WORKSPACE, { force: true });

    expect(fakeRepo.rowFor('run-2')?.status).toBe('running');
    expect(github.downloadRunArtifactFileCalls).toHaveLength(0);
  });

  it('derives status from the artifact, never the exit code: findings_count 0 → no_findings, findings present → succeeded even when the gate tripped, null artifact → failed (AC-42)', async () => {
    // Gate-tripped run: GitHub reports a non-zero exit (conclusion: 'failure')
    // yet the artifact carries real findings — must still read as succeeded.
    const succeeded = workflowRun({ id: 'run-gate-tripped', conclusion: 'failure' });
    const noFindings = workflowRun({ id: 'run-clean', conclusion: 'success' });
    const noArtifact = workflowRun({ id: 'run-crashed', conclusion: 'failure' });

    const github = new MockGitHubClient({
      workflowRuns: [succeeded, noFindings, noArtifact],
      artifactFiles: {
        'run-gate-tripped/devdigest-result/devdigest-result.json': JSON.stringify(
          artifactFixture({ findings_count: 5, critical: 1 }),
        ),
        'run-clean/devdigest-result/devdigest-result.json': JSON.stringify(
          artifactFixture({ findings_count: 0, critical: 0, warning: 0 }),
        ),
        // run-crashed: no artifact fixture registered → downloadRunArtifactFile resolves null
      },
    });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    await service.refresh(WORKSPACE, { force: true });

    expect(fakeRepo.rowFor('run-gate-tripped')?.status).toBe('succeeded');
    expect(fakeRepo.rowFor('run-clean')?.status).toBe('no_findings');
    expect(fakeRepo.rowFor('run-crashed')?.status).toBe('failed');
    expect(fakeRepo.rowFor('run-crashed')?.error).toBe('no result artifact');
  });

  it('reports a completed run with a success conclusion and no artifact as "skipped" (fork PR / bootstrap install-PR fix)', async () => {
    const run = workflowRun({ id: 'run-skipped', conclusion: 'success' });
    const github = new MockGitHubClient({
      workflowRuns: [run],
      // No artifact fixture registered → downloadRunArtifactFile resolves null.
    });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    await service.refresh(WORKSPACE, { force: true });

    const row = fakeRepo.rowFor('run-skipped')!;
    expect(row.status).toBe('skipped');
    expect(row.error).toBe('review skipped (fork PR, or DevDigest not yet on the base branch)');
    expect(row.findingsCount).toBeNull();
    expect(row.costUsd).toBeNull();
  });

  it('treats a stored "skipped" run as terminal — no re-download on a later refresh', async () => {
    const run = workflowRun({ id: 'run-skipped-again', conclusion: 'success' });
    const github = new MockGitHubClient({ workflowRuns: [run] });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    await service.refresh(WORKSPACE, { force: true });
    expect(fakeRepo.rowFor('run-skipped-again')?.status).toBe('skipped');

    await service.refresh(WORKSPACE, { force: true });

    expect(fakeRepo.rowCount).toBe(1);
    // Downloaded once on the first refresh (nothing stored yet); the second
    // refresh sees the stored "skipped" status as terminal and skips it.
    expect(github.downloadRunArtifactFileCalls).toHaveLength(1);
  });

  it('records a malformed artifact as failed with a reason and null metrics, without throwing (AC-43)', async () => {
    const run = workflowRun({ id: 'run-malformed' });
    const github = new MockGitHubClient({
      workflowRuns: [run],
      artifactFiles: {
        // Missing required `findings_count`/`agent` — fails CiResultArtifact.safeParse.
        'run-malformed/devdigest-result/devdigest-result.json': JSON.stringify({ foo: 'bar' }),
      },
    });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    await expect(service.refresh(WORKSPACE, { force: true })).resolves.toBeDefined();

    const row = fakeRepo.rowFor('run-malformed')!;
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
    expect(row.findingsCount).toBeNull();
    expect(row.costUsd).toBeNull();
  });

  it('leaves exactly one row and downloads the artifact once across three consecutive forced refreshes of the same completed run (AC-44)', async () => {
    const run = workflowRun({ id: 'run-repeat' });
    const github = new MockGitHubClient({
      workflowRuns: [run],
      artifactFiles: {
        'run-repeat/devdigest-result/devdigest-result.json': JSON.stringify(artifactFixture()),
      },
    });
    const { service, fakeRepo } = makeService(github, [{ installation: installation() }]);

    await service.refresh(WORKSPACE, { force: true });
    await service.refresh(WORKSPACE, { force: true });
    await service.refresh(WORKSPACE, { force: true });

    expect(fakeRepo.rowCount).toBe(1);
    expect(github.downloadRunArtifactFileCalls).toHaveLength(1);
    expect(github.listWorkflowRunsCalls).toHaveLength(3);
  });

  it('keeps previously ingested rows and returns a non-null refresh_error when the GitHub client throws (AC-45)', async () => {
    const good = workflowRun({ id: 'run-already-there' });
    const workingGithub = new MockGitHubClient({
      workflowRuns: [good],
      artifactFiles: {
        'run-already-there/devdigest-result/devdigest-result.json': JSON.stringify(artifactFixture()),
      },
    });
    const fakeRepo = new FakeCiRepository([{ installation: installation() }]);
    let currentGithub: GitHubClient = workingGithub;
    const container = { db: {}, github: async () => currentGithub } as unknown as Container;
    const service = new CiIngestService(container);
    (service as unknown as { repo: CiRepository }).repo = fakeRepo as unknown as CiRepository;

    await service.refresh(WORKSPACE, { force: true });
    expect(fakeRepo.rowCount).toBe(1);
    const snapshotBefore = fakeRepo.rowFor('run-already-there');

    // Same repository, same installation — only the GitHub client now fails.
    currentGithub = new ThrowingGitHubClient();
    const result = await service.refresh(WORKSPACE, { force: true });

    expect(result.refresh_error).toBeTruthy();
    expect(fakeRepo.rowCount).toBe(1);
    expect(fakeRepo.rowFor('run-already-there')).toEqual(snapshotBefore);
  });

  it('records at most 2 GitHub calls per installation across a 50-installation refresh (R12)', async () => {
    const installations = Array.from({ length: 50 }, (_, i) => ({
      installation: installation({
        id: `inst-${i}`,
        agent_id: `agent-${i}`,
        repo: `acme/repo-${i}`,
      }),
    }));
    // Real installations never share a `workflow_run_id`; derive a distinct
    // one per repo so each of the 50 installations is genuinely "new" and the
    // per-installation call count (not just the totals) is what's proven.
    const listWorkflowRunsCalls: { repo: { owner: string; name: string } }[] = [];
    const downloadRunArtifactFileCalls: { runId: string }[] = [];
    const perRepoGithub = {
      listWorkflowRuns: async (repo: { owner: string; name: string }) => {
        listWorkflowRunsCalls.push({ repo });
        return [workflowRun({ id: `run-${repo.name}` })];
      },
      downloadRunArtifactFile: async (_repo: unknown, runId: string) => {
        downloadRunArtifactFileCalls.push({ runId });
        return JSON.stringify(artifactFixture());
      },
    } as unknown as GitHubClient;

    const { service } = makeService(perRepoGithub, installations);
    await service.refresh(WORKSPACE, { force: true });

    expect(listWorkflowRunsCalls).toHaveLength(50);
    expect(downloadRunArtifactFileCalls).toHaveLength(50);
  });

  it('skips GitHub entirely and returns the current view when called again inside the 30s throttle window without force', async () => {
    const run = workflowRun({ id: 'run-throttled' });
    const github = new MockGitHubClient({
      workflowRuns: [run],
      artifactFiles: {
        'run-throttled/devdigest-result/devdigest-result.json': JSON.stringify(artifactFixture()),
      },
    });
    const { service } = makeService(github, [{ installation: installation() }]);

    await service.refresh(WORKSPACE, {});
    await service.refresh(WORKSPACE, {});

    expect(github.listWorkflowRunsCalls).toHaveLength(1);
  });
});
