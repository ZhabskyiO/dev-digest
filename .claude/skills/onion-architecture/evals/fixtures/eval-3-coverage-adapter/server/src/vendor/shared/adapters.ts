import { z } from 'zod';
import type { PrMeta, PrDetail } from './contracts/platform.js';

/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `server/src/adapters/*`; mock implementations
 * live alongside for tests/dev.
 */

// ---------- Git host ----------
export interface GitHubClient {
  listPullRequests(owner: string, repo: string): Promise<PrMeta[]>;
  getPullRequest(owner: string, repo: string, number: number): Promise<PrDetail>;
  postReviewComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<void>;
}

// ---------- Coverage ----------
export const CodecovApiResponse = z.object({
  commit_sha: z.string(),
  totals: z.object({
    coverage: z.number(),
    lines: z.number().int(),
    hits: z.number().int(),
    misses: z.number().int(),
    partials: z.number().int(),
  }),
  files: z.array(
    z.object({
      name: z.string(),
      totals: z.object({ coverage: z.number(), lines: z.number().int() }),
    }),
  ),
});
export type CodecovApiResponse = z.infer<typeof CodecovApiResponse>;

export interface CodecovClient {
  apiToken: string;
  codecovFetchReport(
    service: 'github' | 'gitlab' | 'bitbucket',
    ownerSlug: string,
    repoSlug: string,
    sha: string,
  ): Promise<CodecovApiResponse>;
  codecovFetchFlags(ownerSlug: string, repoSlug: string): Promise<string[]>;
}
