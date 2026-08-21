import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PrBriefRecord } from '@devdigest/shared';

/**
 * PR Brief data-access. Owns `pr_brief` (one row per PR — the persisted,
 * counts-only envelope) and `pr_file_summary` (one row per `(pr, path)` — a
 * model-written, length-capped summary of one changed file).
 *
 * Neither table carries its own `workspace_id`; both hang off `pull_requests`
 * (`pr_brief.pr_id` / `pr_file_summary.pr_id` → `pull_requests.id`), which
 * does. Workspace scoping for a brief therefore always goes THROUGH that
 * join — never a bare `pr_id` lookup — same shape as
 * `modules/reviews/repository/pull.repo.ts::getIntentDetail`.
 */

/** The full persisted `pr_brief` row. */
export type PrBriefRow = typeof t.prBrief.$inferSelect;

/** Everything `upsertBrief` needs to write in one statement. */
export interface UpsertBriefInput {
  /** The commit this brief was derived from; compared against
   *  `pull_requests.head_sha` by the caller to decide cache hit vs stale. */
  headSha: string;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  /** Null when the model has no known price — never `0`, which would read as
   *  "free" rather than "unknown". */
  costUsd: number | null;
  /**
   * COUNTS ONLY. Typed as `PrBriefRecord` (never `unknown` /
   * `Record<string, unknown>`) so this repository is structurally incapable
   * of persisting a blast snapshot, a verdict summary, or a review-focus
   * list — those are read-time fields resolved fresh from `container.blast`
   * and from `reviews`/`findings`/`pr_files` on every request, never
   * snapshotted here (AC-14/AC-49). See `PrBriefRecord`'s own doc comment
   * (`src/vendor/shared/contracts/pr-brief.ts`) for why widening this shape
   * would be a regression, not a feature.
   */
  json: PrBriefRecord;
}

/** One row `upsertFileSummaries` writes: a single file's model-written summary. */
export interface FileSummaryInput {
  path: string;
  /** Already truncated to the 200-char storage cap by the caller
   *  (`brief/summaries.ts::truncateSummary`) — this repository does not
   *  re-check the length; the `pr_file_summary_len_chk` CHECK constraint is
   *  the last line of defence if a caller ever forgets. */
  summary: string;
}

export class BriefRepository {
  constructor(private db: Db) {}

  // ---- pr_brief -----------------------------------------------------------

  /**
   * The persisted brief row for a PR, scoped to `workspaceId` through a join
   * to `pull_requests` — `pr_brief` carries no `workspace_id` of its own
   * (AC-10). Returns `undefined` both when no brief has been generated yet
   * AND when `prId` belongs to a PR in a different workspace; the two cases
   * are indistinguishable on purpose, same as every other workspace-scoped
   * lookup in this package (e.g. `pull.repo.ts::getIntentDetail`) — a caller
   * must never be able to tell "not generated" apart from "not yours" here.
   *
   * NEVER replace the join with a bare `WHERE pr_id = $1` — that would let a
   * caller in workspace A read a brief that belongs to workspace B's PR.
   */
  async getBriefRow(workspaceId: string, prId: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db
      .select({ brief: t.prBrief })
      .from(t.prBrief)
      .innerJoin(t.pullRequests, eq(t.prBrief.prId, t.pullRequests.id))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.prBrief.prId, prId)));
    return row?.brief;
  }

  /**
   * Insert or refresh the one `pr_brief` row for `prId` — json + head sha +
   * provenance (provider/model/tokens/cost) in a single upsert statement,
   * keyed on the `pr_id` primary key.
   *
   * The stored row (mainly `json`, which is COUNTS ONLY per `PrBriefRecord`)
   * must stay well under the spec's 16 KB budget for a `pr_brief.json` blob —
   * callers must never grow this input beyond the two count fields the type
   * already restricts it to.
   */
  async upsertBrief(prId: string, input: UpsertBriefInput): Promise<void> {
    const values = {
      prId,
      headSha: input.headSha,
      provider: input.provider,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: input.costUsd,
      generatedAt: new Date(),
      json: input.json,
    };
    await this.db
      .insert(t.prBrief)
      .values(values)
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        // MUST list every mutable column: omitting one here means a
        // regenerate silently keeps stale provenance (old model, old cost,
        // old json) while the row otherwise looks freshly written — same
        // rule `pull.repo.ts::upsertIntent` documents for `pr_intent`.
        set: {
          headSha: values.headSha,
          provider: values.provider,
          model: values.model,
          tokensIn: values.tokensIn,
          tokensOut: values.tokensOut,
          costUsd: values.costUsd,
          generatedAt: values.generatedAt,
          json: values.json,
        },
      });
  }

  // ---- pr_file_summary ------------------------------------------------------

  /**
   * Per-file summaries for `prId`, filtered to rows derived from `headSha`.
   *
   * The `head_sha` predicate here is what makes AC-38 unforgeable: a summary
   * written against an older commit is never returned once the PR's head has
   * moved, because it simply isn't a row this query matches — there is no
   * later comparison for a caller to skip or get wrong. Callers MUST NOT
   * re-filter the result by head sha in application code instead of passing
   * the PR's current `head_sha` in here; doing so would make "stale summary
   * survives a head move" a one-line application bug rather than a query
   * that structurally cannot return one.
   */
  async getFileSummaries(prId: string, headSha: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ path: t.prFileSummary.path, summary: t.prFileSummary.summary })
      .from(t.prFileSummary)
      .where(and(eq(t.prFileSummary.prId, prId), eq(t.prFileSummary.headSha, headSha)));

    const result = new Map<string, string>();
    for (const row of rows) result.set(row.path, row.summary);
    return result;
  }

  /**
   * Insert or refresh per-file summaries for `prId` at `headSha` in one
   * multi-row statement, keyed on the `(pr_id, path)` primary key.
   *
   * A no-op call (`rows.length === 0`) is a deliberate early return, not an
   * error — `selectFilesToSummarize` legitimately returns `[]` when every
   * changed file classifies as boilerplate.
   */
  async upsertFileSummaries(
    prId: string,
    headSha: string,
    rows: readonly FileSummaryInput[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const generatedAt = new Date();
    const values = rows.map((row) => ({
      prId,
      path: row.path,
      headSha,
      summary: row.summary,
      generatedAt,
    }));

    await this.db
      .insert(t.prFileSummary)
      .values(values)
      .onConflictDoUpdate({
        target: [t.prFileSummary.prId, t.prFileSummary.path],
        // MUST list every mutable column here too — a re-summarize on a new
        // head sha must overwrite the OLD summary/sha/timestamp, not leave a
        // stale summary sitting under a fresh-looking primary key.
        set: {
          summary: sql`excluded.summary`,
          headSha: sql`excluded.head_sha`,
          generatedAt: sql`excluded.generated_at`,
        },
      });
  }
}
