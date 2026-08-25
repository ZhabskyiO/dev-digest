import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { Db } from '../../db/client.js';

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
export type InsertEvalCase = typeof t.evalCases.$inferInsert;
export type InsertEvalRun = typeof t.evalRuns.$inferInsert;

/** Drizzle access for `eval_cases` / `eval_runs`, always workspace-scoped. */
export class EvalsRepository {
  constructor(private db: Db) {}

  private caseScope(workspaceId: string, ownerId: string, ownerKind: 'agent' | 'skill') {
    return and(
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerKind, ownerKind),
      eq(t.evalCases.ownerId, ownerId),
    );
  }

  listCases(
    workspaceId: string,
    ownerId: string,
    ownerKind: 'agent' | 'skill' = 'agent',
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(this.caseScope(workspaceId, ownerId, ownerKind))
      .orderBy(t.evalCases.name);
  }

  async countCases(workspaceId: string, agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(this.caseScope(workspaceId, agentId, 'agent'));
    return row?.n ?? 0;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.id, id), eq(t.evalCases.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  /** The case created from a given finding, if one exists (idempotent create). */
  async caseByFinding(
    workspaceId: string,
    agentId: string,
    findingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          this.caseScope(workspaceId, agentId, 'agent'),
          sql`${t.evalCases.inputMeta}->>'finding_id' = ${findingId}`,
        ),
      )
      .limit(1);
    return row;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    values: Partial<InsertEvalCase>,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set(values)
      .where(and(eq(t.evalCases.id, id), eq(t.evalCases.workspaceId, workspaceId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.id, id), eq(t.evalCases.workspaceId, workspaceId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async insertRuns(rows: InsertEvalRun[]): Promise<EvalRunRow[]> {
    if (rows.length === 0) return [];
    return this.db.insert(t.evalRuns).values(rows).returning();
  }

  /** All runs over an agent's cases, newest first, case name joined. */
  runsForAgent(
    workspaceId: string,
    ownerId: string,
    limit = 500,
    ownerKind: 'agent' | 'skill' = 'agent',
  ): Promise<{ run: EvalRunRow; caseName: string }[]> {
    return this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(this.caseScope(workspaceId, ownerId, ownerKind))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }

  /** Runs for a set of cases, newest first (caller picks the latest per case). */
  runsForCases(caseIds: string[]): Promise<EvalRunRow[]> {
    if (caseIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt));
  }
}
