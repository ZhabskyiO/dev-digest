import { describe, it, expect } from 'vitest';
import { RequestError } from '@octokit/request-error';
import { strToU8, zipSync } from 'fflate';
import { OctokitGitHubClient } from './octokit.js';

const REPO = { owner: 'acme', name: 'widgets' };

/** Reach past the private `octokit` field to stub `rest.actions.*` — the
 * cheapest hermetic way to exercise the mapping/error-handling logic without
 * a real network call. Mirrors the "stub the octokit client" shape used by
 * `resolveLinkedIssue`-style tests elsewhere in this adapter. */
function actionsOf(client: OctokitGitHubClient) {
  return (client as unknown as { octokit: { rest: { actions: Record<string, unknown> } } })
    .octokit.rest.actions;
}

function authRequestError(status: number, message: string): RequestError {
  return new RequestError(message, status, {
    request: {
      method: 'GET',
      url: 'https://api.github.com/repos/acme/widgets/actions/runs/1/artifacts',
      headers: { authorization: 'token super-secret-pat' },
    },
    response: {
      status,
      url: 'https://api.github.com/repos/acme/widgets/actions/runs/1/artifacts',
      headers: {},
      data: { message },
    },
  });
}

describe('OctokitGitHubClient.listWorkflowRuns', () => {
  it('maps a workflow run to CiWorkflowRun, taking pr_number from pull_requests[0]', async () => {
    const client = new OctokitGitHubClient('tok');
    actionsOf(client).listWorkflowRuns = async () => ({
      data: {
        workflow_runs: [
          {
            id: 123,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/widgets/actions/runs/123',
            pull_requests: [{ number: 42 }],
            created_at: '2026-08-01T00:00:00Z',
            run_started_at: '2026-08-01T00:00:05Z',
            updated_at: '2026-08-01T00:01:00Z',
          },
        ],
      },
    });

    const runs = await client.listWorkflowRuns(REPO, { workflowFile: 'devdigest.yml' });

    expect(runs).toEqual([
      {
        id: '123',
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/acme/widgets/actions/runs/123',
        pr_number: 42,
        created_at: '2026-08-01T00:00:00Z',
        run_started_at: '2026-08-01T00:00:05Z',
        updated_at: '2026-08-01T00:01:00Z',
      },
    ]);
  });

  it('returns [] on a 404 (workflow file not present yet) instead of throwing', async () => {
    const client = new OctokitGitHubClient('tok');
    actionsOf(client).listWorkflowRuns = async () => {
      throw authRequestError(404, 'Not Found');
    };

    await expect(
      client.listWorkflowRuns(REPO, { workflowFile: 'missing.yml' }),
    ).resolves.toEqual([]);
  });

  it('never leaks the token or an authorization header when a non-404 error is thrown', async () => {
    const client = new OctokitGitHubClient('super-secret-pat');
    actionsOf(client).listWorkflowRuns = async () => {
      throw authRequestError(401, 'Bad credentials');
    };

    await expect(
      client.listWorkflowRuns(REPO, { workflowFile: 'devdigest.yml' }),
    ).rejects.toThrow('401 Bad credentials');

    try {
      await client.listWorkflowRuns(REPO, { workflowFile: 'devdigest.yml' });
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('super-secret-pat');
      expect(message.toLowerCase()).not.toContain('authorization');
    }
  });
});

describe('OctokitGitHubClient.downloadRunArtifactFile', () => {
  it('returns the decoded UTF-8 text of the requested entry', async () => {
    const client = new OctokitGitHubClient('tok');
    const zipped = zipSync({ 'result.json': strToU8('{"ok":true}') });
    actionsOf(client).listWorkflowRunArtifacts = async () => ({
      data: { artifacts: [{ id: 99, name: 'devdigest-result' }] },
    });
    actionsOf(client).downloadArtifact = async () => ({ data: zipped.buffer });

    const text = await client.downloadRunArtifactFile(
      REPO,
      '1',
      'devdigest-result',
      'result.json',
    );

    expect(text).toBe('{"ok":true}');
  });

  it('returns null when no artifact matches the requested name', async () => {
    const client = new OctokitGitHubClient('tok');
    actionsOf(client).listWorkflowRunArtifacts = async () => ({
      data: { artifacts: [{ id: 1, name: 'unrelated' }] },
    });

    const result = await client.downloadRunArtifactFile(
      REPO,
      '1',
      'devdigest-result',
      'result.json',
    );

    expect(result).toBeNull();
  });

  it('returns null on a 410 Gone (expired artifact) without throwing', async () => {
    const client = new OctokitGitHubClient('tok');
    actionsOf(client).listWorkflowRunArtifacts = async () => ({
      data: { artifacts: [{ id: 99, name: 'devdigest-result' }] },
    });
    actionsOf(client).downloadArtifact = async () => {
      throw authRequestError(410, 'Gone');
    };

    const result = await client.downloadRunArtifactFile(
      REPO,
      '1',
      'devdigest-result',
      'result.json',
    );

    expect(result).toBeNull();
  });

  it('returns null when the zip does not contain the requested entry', async () => {
    const client = new OctokitGitHubClient('tok');
    const zipped = zipSync({ 'other.json': strToU8('{}') });
    actionsOf(client).listWorkflowRunArtifacts = async () => ({
      data: { artifacts: [{ id: 99, name: 'devdigest-result' }] },
    });
    actionsOf(client).downloadArtifact = async () => ({ data: zipped.buffer });

    const result = await client.downloadRunArtifactFile(
      REPO,
      '1',
      'devdigest-result',
      'result.json',
    );

    expect(result).toBeNull();
  });

  it('returns null for an oversized compressed download without ever inflating it', async () => {
    const client = new OctokitGitHubClient('tok');
    actionsOf(client).listWorkflowRunArtifacts = async () => ({
      data: { artifacts: [{ id: 99, name: 'devdigest-result' }] },
    });
    // Garbage bytes, not a real zip — if the compressed-size cap were checked
    // AFTER calling `unzipSync`, this would throw instead of returning null.
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
    actionsOf(client).downloadArtifact = async () => ({ data: oversized.buffer });

    const result = await client.downloadRunArtifactFile(
      REPO,
      '1',
      'devdigest-result',
      'result.json',
    );

    expect(result).toBeNull();
  });

  it('returns null when the requested entry declares an originalSize over the cap', async () => {
    const client = new OctokitGitHubClient('tok');
    // Highly repetitive content compresses to a tiny compressed size while
    // still declaring an `originalSize` over `MAX_ARTIFACT_ENTRY_BYTES` — this
    // proves the per-entry declared-size cap, independent of the overall
    // compressed-zip-size cap above.
    const huge = strToU8('0'.repeat(11 * 1024 * 1024));
    const zipped = zipSync({ 'result.json': huge });
    actionsOf(client).listWorkflowRunArtifacts = async () => ({
      data: { artifacts: [{ id: 99, name: 'devdigest-result' }] },
    });
    actionsOf(client).downloadArtifact = async () => ({ data: zipped.buffer });

    const result = await client.downloadRunArtifactFile(
      REPO,
      '1',
      'devdigest-result',
      'result.json',
    );

    expect(result).toBeNull();
  });

  it('never leaks the token when a non-404/410 error is thrown', async () => {
    const client = new OctokitGitHubClient('super-secret-pat');
    actionsOf(client).listWorkflowRunArtifacts = async () => {
      throw authRequestError(500, 'Internal Server Error');
    };

    try {
      await client.downloadRunArtifactFile(REPO, '1', 'devdigest-result', 'result.json');
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toBe('500 Internal Server Error');
      expect(message).not.toContain('super-secret-pat');
      expect(message.toLowerCase()).not.toContain('authorization');
    }
  });
});
