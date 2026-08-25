import type { EvalBatch, EvalExpectation } from '@devdigest/shared';
import { EvalExpectation as EvalExpectationSchema, Provider } from '@devdigest/shared';
import type { FindingRow } from '../../db/rows.js';
import type { EvalRunRow } from './repository.js';

/** Pure helpers for the evals module — no I/O. */

/** "Hardcoded Stripe secret key!" → "hardcoded-stripe-secret-key". */
export function slugifyCaseName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'eval-case';
}

/** Rebuild a minimal single-file unified diff from a stored pr_files patch. */
export function buildDiffFragment(path: string, patch: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    patch.trimEnd(),
    '',
  ].join('\n');
}

export type FindingDecision = 'accepted' | 'dismissed';

/** The reviewer's verdict on a finding; null while undecided. */
export function decisionOf(f: Pick<FindingRow, 'acceptedAt' | 'dismissedAt'>): FindingDecision | null {
  if (f.acceptedAt && f.dismissedAt) {
    // Both stamped (accept after dismiss or vice versa) — latest wins.
    return f.acceptedAt >= f.dismissedAt ? 'accepted' : 'dismissed';
  }
  if (f.acceptedAt) return 'accepted';
  if (f.dismissedAt) return 'dismissed';
  return null;
}

/** accepted → must_find ("has to find X at file:line"), dismissed → must_not_flag. */
export function expectationFromFinding(f: FindingRow, decision: FindingDecision): EvalExpectation {
  return {
    type: decision === 'accepted' ? 'must_find' : 'must_not_flag',
    file: f.file,
    start_line: f.startLine,
    end_line: f.endLine,
    severity: f.severity as EvalExpectation['severity'],
    category: f.category as EvalExpectation['category'],
    title: f.title,
    source_finding_id: f.id,
  };
}

/** Parse a stored `expected_output` blob; null when malformed. */
export function parseExpectation(v: unknown): EvalExpectation | null {
  const r = EvalExpectationSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** Batch metadata stamped into each `eval_runs.actual_output` by the runner. */
export interface BatchMeta {
  batch_id: string;
  agent_id: string;
  agent_version: number | null;
  model: string | null;
  provider: string | null;
  findings_count: number | null;
  skill_id: string | null;
  batch_baseline: EvalBatch['baseline'] | null;
  /** 'set' = one press of "Run evals" over the whole case set; 'case' = a
   *  single-case run from the case editor / play button. Only 'set' batches
   *  belong in the run history — they are the comparable unit. */
  scope: 'set' | 'case';
}

export function batchMetaOf(run: EvalRunRow): BatchMeta | null {
  const a = run.actualOutput as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') return null;
  const batchId = a['batch_id'];
  const agentId = a['agent_id'];
  if (typeof batchId !== 'string' || typeof agentId !== 'string') return null;
  const findings = a['findings'];
  return {
    batch_id: batchId,
    agent_id: agentId,
    scope: a['scope'] === 'case' ? 'case' : 'set',
    agent_version: typeof a['agent_version'] === 'number' ? (a['agent_version'] as number) : null,
    model: typeof a['model'] === 'string' ? (a['model'] as string) : null,
    provider: typeof a['provider'] === 'string' ? (a['provider'] as string) : null,
    findings_count: Array.isArray(findings) ? findings.length : null,
    skill_id: typeof a['skill_id'] === 'string' ? (a['skill_id'] as string) : null,
    batch_baseline:
      a['batch_baseline'] && typeof a['batch_baseline'] === 'object'
        ? (a['batch_baseline'] as EvalBatch['baseline'])
        : null,
  };
}

/**
 * Fold per-case `eval_runs` rows (newest first) into batches — one batch per
 * press of "Run evals". The given schema has no batch table, so the runner
 * stamps a shared `batch_id` into `actual_output` and duplicates the
 * batch-level metrics onto each row's metric columns; here we re-aggregate.
 * Rows without a parseable batch stamp are skipped (pre-pipeline rows).
 */
export function groupRunsIntoBatches(rows: { run: EvalRunRow }[]): EvalBatch[] {
  const order: string[] = [];
  const acc = new Map<string, EvalBatch>();

  for (const { run } of rows) {
    const meta = batchMetaOf(run);
    // Single-case runs update a case's last_run status but are not comparable
    // batches — a 1-case "batch" would wreck the recall/precision history.
    if (!meta || meta.scope === 'case') continue;
    let batch = acc.get(meta.batch_id);
    if (!batch) {
      const provider = Provider.safeParse(meta.provider);
      batch = {
        batch_id: meta.batch_id,
        agent_id: meta.agent_id,
        agent_version: meta.agent_version,
        model: meta.model,
        provider: provider.success ? provider.data : null,
        ran_at: run.ranAt.toISOString(),
        recall: run.recall,
        precision: run.precision,
        citation_accuracy: run.citationAccuracy,
        passed: 0,
        total: 0,
        duration_ms: 0,
        cost_usd: 0,
        skill_id: meta.skill_id,
        baseline: meta.batch_baseline ?? null,
      };
      acc.set(meta.batch_id, batch);
      order.push(meta.batch_id);
    }
    batch.total += 1;
    if (run.pass) batch.passed += 1;
    batch.duration_ms = (batch.duration_ms ?? 0) + (run.durationMs ?? 0);
    batch.cost_usd = batch.cost_usd == null || run.costUsd == null ? null : batch.cost_usd + run.costUsd;
  }

  return order.map((id) => acc.get(id)!);
}
