import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * onboarding data-access (T7). The ONLY file that touches `t.onboarding` —
 * every other module (service, routes) reaches this table through this
 * repository.
 *
 * `get`/`upsert` intentionally return/accept the raw `json` as `unknown`,
 * never parsed through the `Onboarding` contract: a row that fails the
 * six-section shape (the spec's "legacy row" edge case) must be treatable as
 * *absent* by the caller, which is a domain decision that belongs in the
 * service, not here.
 */

export interface OnboardingRow {
  json: unknown;
  generatedAt: Date;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  async get(repoId: string): Promise<OnboardingRow | null> {
    const [row] = await this.db
      .select({ json: t.onboarding.json, generatedAt: t.onboarding.generatedAt })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    return row ?? null;
  }

  /**
   * Insert-or-replace on the `repo_id` primary key (AC-24): a successful
   * regeneration always leaves exactly one row for `repoId`, with `json`
   * replaced and `generatedAt` advanced to now — no history is retained.
   */
  async upsert(repoId: string, payload: unknown): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: payload, generatedAt: new Date() })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: {
          json: sql`excluded.json`,
          generatedAt: sql`excluded.generated_at`,
        },
      });
  }

  async remove(repoId: string): Promise<void> {
    await this.db.delete(t.onboarding).where(eq(t.onboarding.repoId, repoId));
  }
}
