/**
 * runLocalReview — application layer for the `devdigest review` CLI.
 *
 * Resolves the optional agent arg, posts the collected diff to
 * `POST /reviews/local`, and returns a plain discriminated union. No terminal
 * output, no `process.exit`, no git — those belong to `src/cli/*`, so this
 * function stays testable and reusable (e.g. from a future MCP tool that wants
 * to review a working tree).
 *
 * The reviewer itself lives on the server: this module never assembles a
 * prompt, calls a model, or decides what counts as a blocker. `blocking` comes
 * back from `countBlockers` in @devdigest/reviewer-core, the same gate a PR
 * review and CI use.
 *
 * Layer: application/orchestration. Imports the client (infrastructure) and
 * @devdigest/shared types only — never the MCP SDK or the CLI.
 */

import type { CiFailOn, LocalReviewMode, LocalReviewResult } from '@devdigest/shared';
import type { DevDigestClient } from '../http/client.js';
import type { resolveAgentId as ResolveAgentIdFn } from './resolve.js';

export type LocalReviewDone = { kind: 'done'; result: LocalReviewResult };
/** The review could not be produced — the CLI turns this into a non-zero exit. */
export type LocalReviewFailed = { kind: 'failed'; error: string };
export type LocalReviewOutcome = LocalReviewDone | LocalReviewFailed;

export type LocalReviewParams = {
  mode: LocalReviewMode;
  diff: string;
  /** Agent id or name. Omitted → the server picks, if exactly one is enabled. */
  agent?: string;
  /** `owner/name` of an imported repo — enables repo-intel context. */
  repo?: string;
  failOn?: CiFailOn;
  label?: string;
};

export type LocalReviewOpts = { timeoutMs: number };

export type LocalReviewDeps = { resolveAgentId: typeof ResolveAgentIdFn };

export async function runLocalReview(
  client: DevDigestClient,
  params: LocalReviewParams,
  opts: LocalReviewOpts,
  deps: LocalReviewDeps,
): Promise<LocalReviewOutcome> {
  let agentId: string | undefined;
  if (params.agent !== undefined) {
    const resolved = await deps.resolveAgentId(client, params.agent);
    if ('error' in resolved) return { kind: 'failed', error: resolved.error };
    agentId = resolved.agentId;
  }

  try {
    const result = await client.reviewLocalDiff(
      {
        mode: params.mode,
        diff: params.diff,
        ...(agentId !== undefined ? { agentId } : {}),
        ...(params.repo !== undefined ? { repo: params.repo } : {}),
        ...(params.failOn !== undefined ? { failOn: params.failOn } : {}),
        ...(params.label !== undefined ? { label: params.label } : {}),
      },
      { timeoutMs: opts.timeoutMs },
    );
    return { kind: 'done', result };
  } catch (cause) {
    return { kind: 'failed', error: describeFailure(cause, opts.timeoutMs) };
  }
}

/**
 * Turn a thrown client error into one line a developer can act on. The API's
 * structured error envelope (`{ error: { code, message } }`) is embedded in
 * ApiError's message as raw JSON, so unwrap it when it is there.
 */
function describeFailure(cause: unknown, timeoutMs: number): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return `The review did not finish within ${Math.round(timeoutMs / 1000)}s. Raise --timeout, or review a smaller change.`;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const brace = message.indexOf('{');
  if (brace !== -1) {
    try {
      const parsed: unknown = JSON.parse(message.slice(brace));
      const envelope = parsed as { error?: { message?: string } };
      if (envelope.error?.message) return envelope.error.message;
    } catch {
      // Not JSON after all — fall through to the raw message.
    }
  }
  return message;
}
