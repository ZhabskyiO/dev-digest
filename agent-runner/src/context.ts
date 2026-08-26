import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { RunnerError } from './errors.js';

/**
 * Resolves the PR context (owner/repo/number/title/body/fork) from the
 * GitHub-Actions-injected env vars + the standard `pull_request` event
 * payload — "the CI context" the runner assembles the diff + PR body/title
 * from (T8 action). `GITHUB_REPOSITORY` and `PR_NUMBER` are explicit env vars
 * the generated workflow sets (`server/src/modules/ci/workflow.ts`);
 * `GITHUB_EVENT_PATH` is a default GitHub Actions runtime var (always present)
 * pointing at the JSON payload for the triggering event, which carries the
 * (untrusted, author-controlled) PR title/body and the fork flag.
 */

export interface CiEnv {
  GITHUB_REPOSITORY?: string;
  PR_NUMBER?: string;
  GITHUB_EVENT_PATH?: string;
  [key: string]: string | undefined;
}

export interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
  /** PR title (untrusted, author-controlled). */
  title: string;
  /** PR body/description (untrusted, author-controlled). */
  body: string;
  /** True when the PR head is a fork — informational only; the workflow
   *  itself is responsible for never scheduling this job for fork PRs. */
  isFork: boolean;
}

// `GITHUB_EVENT_PATH` points at JSON authored by GitHub, but its shape is
// still external input by the time it reaches us — validate the subset we
// use rather than trusting an `as` cast on `JSON.parse`'s output, so a
// shape drift (e.g. `number` arriving as a string) fails closed instead of
// silently propagating a wrong-typed value past every `?.`/`??` downstream.
const PullRequestEventPayload = z.object({
  pull_request: z
    .object({
      number: z.number().optional(),
      title: z.string().optional(),
      body: z.string().nullish(),
      head: z
        .object({
          repo: z
            .object({ fork: z.boolean().optional() })
            .nullish(),
        })
        .optional(),
    })
    .optional(),
});
type PullRequestEventPayload = z.infer<typeof PullRequestEventPayload>;

function readEventPayload(
  eventPath: string | undefined,
  readFile: typeof readFileSync,
): PullRequestEventPayload | null {
  if (!eventPath) return null;
  let raw: string;
  try {
    raw = readFile(eventPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = PullRequestEventPayload.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Resolve the PR context from env + (best-effort) event payload. */
export function resolvePrContext(
  env: CiEnv,
  readFile: typeof readFileSync = readFileSync,
): PrContext {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes('/')) {
    throw new RunnerError(
      `GITHUB_REPOSITORY must be set to "owner/name" (got: ${JSON.stringify(repository)})`,
    );
  }
  const [owner, repo] = repository.split('/', 2) as [string, string];

  const event = readEventPayload(env.GITHUB_EVENT_PATH, readFile);
  const pr = event?.pull_request;

  const prNumberRaw = env.PR_NUMBER ?? (pr?.number != null ? String(pr.number) : undefined);
  const prNumber = prNumberRaw ? Number(prNumberRaw) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new RunnerError(
      `PR_NUMBER must resolve to a positive integer (env PR_NUMBER=${JSON.stringify(env.PR_NUMBER)}, event pull_request.number=${JSON.stringify(pr?.number)})`,
    );
  }

  return {
    owner,
    repo,
    prNumber,
    title: pr?.title ?? '',
    body: pr?.body ?? '',
    isFork: pr?.head?.repo?.fork ?? false,
  };
}
