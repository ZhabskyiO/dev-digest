import { Octokit, RequestError } from 'octokit';
import { strFromU8, unzipSync } from 'fflate';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  CiWorkflowRun,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { extractTicketRefs } from '../../platform/ticket-refs.js';

const TIMEOUT = 30_000;

/** Default page size for `listWorkflowRuns` when the caller doesn't ask for a specific one. */
const DEFAULT_WORKFLOW_RUNS_PER_PAGE = 20;

/**
 * Ceiling on a single decoded artifact entry's DECLARED (uncompressed) size,
 * enforced via `unzipSync`'s `filter` option — i.e. BEFORE `fflate` ever
 * inflates the entry's bytes, not after. The artifact zip is produced by a
 * job running in a third-party (target) repo, so it is attacker-adjacent
 * content — this is the zip-bomb / memory-blowup guard, mirroring
 * `modules/skills/helpers.ts`'s `MAX_ARCHIVE_UNCOMPRESSED_BYTES`.
 */
const MAX_ARTIFACT_ENTRY_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Ceiling on the COMPRESSED artifact zip itself, checked on the raw
 * `download.data` bytes before `unzipSync` is ever called. Without this, a
 * small crafted zip could still declare a small `originalSize` per entry
 * while the compressed payload itself is enormous (or a hostile
 * `originalSize` lie combined with a huge compressed stream) — capping the
 * compressed size we're willing to even hand to the unzip step is a second,
 * independent guard on top of the per-entry `filter` below.
 */
const MAX_ARTIFACT_ZIP_BYTES = 20 * 1024 * 1024; // 20 MiB

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/** Narrow an Octokit workflow-run `status` (a loose `string | null` in the
 * upstream OpenAPI types — GitHub also returns "waiting"/"requested"/etc.)
 * down to `CiWorkflowRun`'s closed union. Anything not yet `in_progress` or
 * `completed` is reported as `queued` — the safe "not done yet" default. */
function mapRunStatus(status: string | null): CiWorkflowRun['status'] {
  if (status === 'in_progress' || status === 'completed') return status;
  return 'queued';
}

/**
 * Map any error thrown by an Octokit call to a message-only `Error`. An
 * Octokit `RequestError` carries the full request (including the
 * `Authorization: token <PAT>` header) on `.request` and the raw response on
 * `.response` — neither must ever reach a log line or a thrown error message
 * (the PAT is injected via `container.secrets`). Only `status` + `message`
 * (the API's own error body, e.g. "Bad credentials" — never the header) are
 * carried forward.
 */
function sanitizeOctokitError(err: unknown): Error {
  if (err instanceof RequestError) {
    return new Error(`${err.status} ${err.message}`);
  }
  if (err instanceof Error) {
    return new Error(err.message);
  }
  return new Error('Unknown GitHub API error');
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * Linked issue via `extractTicketRefs` — a closing keyword (closes/fixes/
   * resolves, …) is now REQUIRED, so a bare `#123` (e.g. "issue #1 of 3" or a
   * markdown ordered list) no longer resolves as a linked issue. This
   * deliberately narrows `PrDetail.linked_issue` versus the old optional-
   * keyword regex (Intent Layer plan R-8) — do not "fix" it back.
   *
   * Only the first SAME-repo ref is fetched. Cross-repo refs
   * (`owner/repo#123`) are captured by the matcher but never fetched here —
   * this client only holds a token scoped to the current repo.
   */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const ref = extractTicketRefs(body).find((r) => !r.crossRepo);
    if (!ref) return undefined;
    try {
      return await this.getIssue(repo, ref.number);
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  /**
   * Batch sibling of `getIssue`. Per-issue failures are dropped, never
   * thrown — a single 404 (or any other fetch error) must not fail intent
   * derivation for the whole PR. Dedupes the input before fetching; an empty
   * array short-circuits to `[]` with zero API calls.
   */
  async getIssues(repo: RepoRef, numbers: number[]): Promise<IssueMeta[]> {
    const unique = [...new Set(numbers)];
    if (unique.length === 0) return [];
    const results = await Promise.allSettled(unique.map((n) => this.getIssue(repo, n)));
    return results
      .filter((r): r is PromiseFulfilledResult<IssueMeta> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  /**
   * Runs of the given workflow file that were triggered by a `pull_request`
   * event, newest first (the API's own default order) — up to `perPage`
   * (default 20). A 404 (the workflow file doesn't exist yet in the target
   * repo, e.g. the install PR hasn't merged) reads as "no runs yet" and
   * returns `[]` rather than surfacing as a refresh error; every other
   * failure is sanitized and rethrown.
   */
  async listWorkflowRuns(
    repo: RepoRef,
    opts: { workflowFile: string; perPage?: number },
  ): Promise<CiWorkflowRun[]> {
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: opts.workflowFile,
            event: 'pull_request',
            per_page: opts.perPage ?? DEFAULT_WORKFLOW_RUNS_PER_PAGE,
          }),
          TIMEOUT,
        ),
      );
      return res.data.workflow_runs.map((run) => ({
        id: String(run.id),
        status: mapRunStatus(run.status),
        conclusion: run.conclusion ?? null,
        html_url: run.html_url,
        // Forks are skipped by the generated workflow, so every run here is
        // same-repo and this array is populated.
        pr_number: run.pull_requests?.[0]?.number ?? null,
        created_at: run.created_at,
        run_started_at: run.run_started_at ?? null,
        updated_at: run.updated_at,
      }));
    } catch (err) {
      if (err instanceof RequestError && err.status === 404) return [];
      throw sanitizeOctokitError(err);
    }
  }

  /**
   * The UTF-8 text of `fileName` inside `runId`'s `artifactName` artifact
   * zip, decoded entirely in memory via `fflate.unzipSync` — nothing is ever
   * written to disk. Two independent caps bound how much this call will ever
   * inflate: the raw compressed download is rejected outright above
   * `MAX_ARTIFACT_ZIP_BYTES`, and `unzipSync`'s `filter` option is used so
   * ONLY the single requested entry (matched by exact name, never
   * path-joined) whose DECLARED `originalSize` is within
   * `MAX_ARTIFACT_ENTRY_BYTES` is ever decompressed — every other entry in
   * the archive, and an oversized requested entry, is skipped by `fflate`
   * before inflation, not filtered out after. Returns `null`, never throws,
   * when the artifact doesn't exist, has expired (410 Gone), is too large,
   * or doesn't contain the requested file within the size cap.
   */
  async downloadRunArtifactFile(
    repo: RepoRef,
    runId: string,
    artifactName: string,
    fileName: string,
  ): Promise<string | null> {
    try {
      const list = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: Number(runId),
            per_page: 100,
          }),
          TIMEOUT,
        ),
      );
      const artifact = list.data.artifacts.find((a) => a.name === artifactName);
      if (!artifact) return null;

      const download = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: artifact.id,
            archive_format: 'zip',
          }),
          TIMEOUT,
        ),
      );
      const bytes = new Uint8Array(download.data as ArrayBuffer);
      if (bytes.byteLength > MAX_ARTIFACT_ZIP_BYTES) return null;
      const entries = unzipSync(bytes, {
        filter: (f) => f.name === fileName && f.originalSize <= MAX_ARTIFACT_ENTRY_BYTES,
      });
      const entry = entries[fileName];
      if (!entry) return null;
      return strFromU8(entry);
    } catch (err) {
      if (err instanceof RequestError && (err.status === 404 || err.status === 410)) {
        return null;
      }
      throw sanitizeOctokitError(err);
    }
  }
}
