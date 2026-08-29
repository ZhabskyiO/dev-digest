import { describe, it, expect } from 'vitest';
import {
  MultiAgentRun,
  MultiAgentRunRequest,
  MultiAgentRunStartResponse,
  AgentRunEstimate,
  PrAgentEstimates,
  AgentColumn,
  AgentColumnFinding,
  Conflict,
  ConflictTake,
} from '@devdigest/shared';
import type { FindingRecord } from '@devdigest/shared';

/**
 * Contract tests for T1 — the multi-agent read surface plus the
 * start-request/estimate contracts it unblocks. See
 * `server/src/vendor/shared/contracts/observability.ts` for the schemas.
 */
describe('MultiAgentRun (GET /pulls/:id/multi-agent)', () => {
  const failedColumn = {
    run_id: 'run-2',
    agent_id: 'agent-2',
    agent_name: 'Security Reviewer',
    provider: null,
    model: null,
    status: 'failed' as const,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    error: 'provider timeout after 3 attempts',
    findings: [],
  };

  const runningColumn = {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Style Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'running' as const,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    error: null,
    findings: [],
  };

  const doneColumn = {
    run_id: 'run-3',
    agent_id: 'agent-3',
    agent_name: 'Correctness Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'done' as const,
    verdict: 'request_changes',
    score: 61,
    summary: 'Two blockers before merge.',
    duration_ms: 8200,
    cost_usd: 0.12,
    error: null,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        confidence: 0.98,
        rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
        suggestion: 'Move to env and rotate.',
        review_id: 'rev-1',
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  };

  it('parses a running multi-agent run', () => {
    expect(() =>
      MultiAgentRun.parse({
        id: 'mar-1',
        pr_id: 'p1',
        pr_number: 482,
        ran_at: '2026-08-27T00:00:00.000Z',
        agent_count: 2,
        status: 'running',
        total_duration_ms: null,
        total_cost_usd: null,
        shared_error: null,
        columns: [runningColumn, failedColumn],
        conflicts: [],
      }),
    ).not.toThrow();
  });

  it('parses a complete multi-agent run with a failed column (recorded error), a range-based conflict, and note-less + noted takes', () => {
    const parsed = MultiAgentRun.parse({
      id: 'mar-2',
      pr_id: 'p1',
      pr_number: 482,
      ran_at: '2026-08-27T00:05:00.000Z',
      agent_count: 3,
      status: 'complete',
      total_duration_ms: 8200,
      total_cost_usd: 0.12,
      shared_error: null,
      columns: [doneColumn, failedColumn, runningColumn],
      conflicts: [
        {
          file: 'src/config.ts',
          start_line: 10,
          end_line: 14,
          title: 'Hardcoded secret vs. no issue raised',
          takes: [
            {
              agent_id: 'agent-3',
              agent_name: 'Correctness Reviewer',
              verdict: 'CRITICAL',
              note: 'Confirmed literal key on line 12.',
            },
            {
              agent_id: 'agent-1',
              agent_name: 'Style Reviewer',
              verdict: 'ignored',
              // note omitted — a note-less take, since this agent never flagged this location.
            },
          ],
        },
      ],
    });
    expect(parsed.columns.find((c) => c.status === 'failed')?.error).toBe(
      'provider timeout after 3 attempts',
    );
    expect(parsed.conflicts[0]!.start_line).toBe(10);
    expect(parsed.conflicts[0]!.end_line).toBe(14);
    expect(parsed.conflicts[0]!.takes[1]!.note).toBeUndefined();
  });

  it('rejects a Conflict built with the old `line` field alone — start_line/end_line are required', () => {
    expect(() =>
      Conflict.parse({
        file: 'src/config.ts',
        line: 12,
        title: 'x',
        takes: [],
      }),
    ).toThrow();
  });

  it('AgentColumn.status accepts the full lifecycle enum including queued/cancelled', () => {
    expect(() =>
      AgentColumn.parse({ ...runningColumn, status: 'queued' }),
    ).not.toThrow();
    expect(() =>
      AgentColumn.parse({ ...runningColumn, status: 'cancelled' }),
    ).not.toThrow();
    expect(() => AgentColumn.parse({ ...runningColumn, status: 'bogus' })).toThrow();
  });

  it('ConflictTake uses agent_name (not persona)', () => {
    const take = ConflictTake.parse({
      agent_id: 'agent-1',
      agent_name: 'Style Reviewer',
      verdict: 'ignored',
    });
    expect(take.agent_name).toBe('Style Reviewer');
    expect((take as Record<string, unknown>).persona).toBeUndefined();
  });
});

describe('MultiAgentRunRequest (POST /pulls/:id/multi-agent-run body)', () => {
  const AGENT_X = '11111111-1111-1111-1111-111111111111';
  const AGENT_Y = '22222222-2222-2222-2222-222222222222';

  it('rejects an empty agent set', () => {
    expect(MultiAgentRunRequest.safeParse({ agent_ids: [] }).success).toBe(false);
  });

  it('rejects a duplicate agent id', () => {
    expect(
      MultiAgentRunRequest.safeParse({ agent_ids: [AGENT_X, AGENT_X] }).success,
    ).toBe(false);
  });

  it('accepts two distinct agent ids', () => {
    expect(
      MultiAgentRunRequest.safeParse({ agent_ids: [AGENT_X, AGENT_Y] }).success,
    ).toBe(true);
  });
});

describe('MultiAgentRunStartResponse / AgentRunEstimate / PrAgentEstimates', () => {
  it('parses a start response shaped like ReviewRunTarget', () => {
    expect(() =>
      MultiAgentRunStartResponse.parse({
        multi_run_id: 'mar-1',
        pr_id: 'p1',
        runs: [
          { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Style Reviewer' },
          { run_id: 'run-2', agent_id: 'agent-2', agent_name: 'Security Reviewer' },
        ],
      }),
    ).not.toThrow();
  });

  it('parses an agent run estimate and the PR-scoped estimates envelope', () => {
    const estimate = AgentRunEstimate.parse({
      agent_id: 'agent-1',
      agent_name: 'Style Reviewer',
      est_duration_ms: 8200,
      est_cost_usd: 0.12,
      runs_sampled: 5,
      last_summary: 'Two blockers before merge.',
    });
    expect(estimate.runs_sampled).toBe(5);
    expect(() =>
      PrAgentEstimates.parse({
        pr_id: 'p1',
        agents: [
          estimate,
          {
            agent_id: 'agent-2',
            agent_name: 'Security Reviewer',
            est_duration_ms: null,
            est_cost_usd: null,
            runs_sampled: 0,
            last_summary: null,
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe('AgentColumnFinding assignability to FindingRecord', () => {
  it('a value built to the AgentColumnFinding shape is assignable where a FindingRecord is expected', () => {
    // `category` here is left as a literal ('security') rather than widened to
    // `string` — using `satisfies` (not a `: AgentColumnFinding` annotation)
    // preserves that literal type, which is exactly why `AgentColumnFinding.category`
    // is declared as a plain `z.string()`: it validates the broader shape while
    // letting a concrete literal value still satisfy `FindingRecord`'s narrower
    // `FindingCategory` enum on the receiving end.
    const columnFinding = {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      confidence: 0.98,
      rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
      suggestion: 'Move to env and rotate.',
      review_id: 'rev-1',
      accepted_at: null,
      dismissed_at: null,
    } satisfies AgentColumnFinding;

    const asFindingRecord: FindingRecord = columnFinding;
    expect(asFindingRecord.review_id).toBe('rev-1');
  });
});
