import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type {
  Intent,
  IntentConfidenceTier,
  IntentSource,
  PrIntentDetail,
} from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

export async function getPrCommits(
  db: Db,
  prId: string,
): Promise<(typeof t.prCommits.$inferSelect)[]> {
  return db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent -----------------------------------------------------------------

/** Everything a derivation knows about itself, persisted in one upsert. */
export interface UpsertIntentInput {
  intent: Intent;
  /** The commit this derivation describes; compared against `pull_requests.head_sha`
   *  by the caller to decide cache hit vs stale. */
  headSha: string;
  confidence: IntentConfidenceTier;
  confidenceScore: number;
  sources: IntentSource[];
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  /** Null when the model has no known price — never `0`, which would read as
   *  "free" rather than "unknown". */
  costUsd: number | null;
}

/** The full persisted row — the shape a re-derive cache check needs (`headSha`
 *  in particular), not just the three `Intent` fields. */
export type IntentRow = typeof t.prIntent.$inferSelect;

export async function upsertIntent(
  db: Db,
  prId: string,
  input: UpsertIntentInput,
): Promise<void> {
  const values = {
    prId,
    intent: input.intent.intent,
    inScope: input.intent.in_scope,
    outOfScope: input.intent.out_of_scope,
    headSha: input.headSha,
    confidence: input.confidence,
    confidenceScore: input.confidenceScore,
    sources: input.sources,
    provider: input.provider,
    model: input.model,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costUsd: input.costUsd,
    derivedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      // MUST list every mutable column: omitting one here means a re-derive
      // silently keeps stale provenance (old model, old cost, old derived_at)
      // while the row otherwise looks freshly written.
      set: {
        intent: values.intent,
        inScope: values.inScope,
        outOfScope: values.outOfScope,
        headSha: values.headSha,
        confidence: values.confidence,
        confidenceScore: values.confidenceScore,
        sources: values.sources,
        provider: values.provider,
        model: values.model,
        tokensIn: values.tokensIn,
        tokensOut: values.tokensOut,
        costUsd: values.costUsd,
        derivedAt: values.derivedAt,
      },
    });
}

export async function getIntent(db: Db, prId: string): Promise<IntentRow | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  return row;
}

/**
 * Workspace-scoped intent lookup for `GET /pulls/:id/intent`.
 *
 * `pr_intent` has no `workspace_id` of its own — the only ownership link is
 * `pr_intent.pr_id -> pull_requests.id`, which itself carries `workspace_id`.
 * A lookup by `pr_id` alone (skipping the join/filter) would let a caller in
 * workspace A read a `pr_id` that belongs to workspace B. This MUST stay
 * joined and filtered; do not "simplify" it back to a bare `pr_id` lookup.
 */
export async function getIntentDetail(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PrIntentDetail | undefined> {
  const [row] = await db
    .select({ intent: t.prIntent, pull: t.pullRequests })
    .from(t.prIntent)
    .innerJoin(t.pullRequests, eq(t.prIntent.prId, t.pullRequests.id))
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.prIntent.prId, prId)));
  if (!row) return undefined;

  const intent = row.intent;
  return {
    intent: intent.intent,
    in_scope: intent.inScope,
    out_of_scope: intent.outOfScope,
    pr_id: intent.prId,
    head_sha: intent.headSha,
    confidence: {
      tier: intent.confidence as IntentConfidenceTier,
      score: intent.confidenceScore,
      sources: intent.sources,
    },
    provider: intent.provider,
    model: intent.model,
    cost_usd: intent.costUsd,
    derived_at: intent.derivedAt.toISOString(),
  };
}
