import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  BlastRadiusResult,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({
        intent: 'x',
        in_scope: ['a'],
        out_of_scope: ['b'],
        risk_areas: [{ kind: 'security', label: 'Auth surface touched' }],
      }),
    ).not.toThrow();
    // `risk_areas` is required, like `out_of_scope` — the model is told to send
    // `[]`, not to omit the key. A `.default([])` would have made this pass and
    // would also have put an unsupported `default` keyword in the strict JSON
    // schema handed to the provider.
    expect(() => Intent.parse({ intent: 'x', in_scope: [], out_of_scope: [] })).toThrow();
    // `kind` is a closed enum: an unknown bucket would render a chip with no icon.
    expect(() =>
      Intent.parse({
        intent: 'x',
        in_scope: [],
        out_of_scope: [],
        risk_areas: [{ kind: 'nonsense', label: 'x' }],
      }),
    ).toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

/**
 * `BlastRadiusResult` is the API/UI/MCP shape of GET /pulls/:id/blast — it is
 * NOT the brief's `BlastRadius` block above. It doubles as the route's response
 * schema, so a missing key here is a 500 at serialization time, not a type error.
 */
describe('BlastRadiusResult (GET /pulls/:id/blast)', () => {
  const valid = {
    pull_id: 'p1',
    status: 'ready' as const,
    reason: null,
    degraded: false,
    indexed_sha: '6c415f1d0745c6e1416d799cfb2803b895dcbfec',
    changed_files: ['src/limit.ts'],
    symbols: [
      {
        name: 'rateLimit',
        kind: 'function',
        file: 'src/limit.ts',
        callers: [{ file: 'src/api/index.ts', line: 23, symbol: 'publicRouter', rank: 0.9 }],
        caller_count: 4,
        endpoints: [{ method: 'GET', path: '/api/public/items', file: 'src/api/index.ts' }],
        crons: ['reset-rate-buckets (hourly)'],
      },
    ],
    endpoints: [{ method: 'GET', path: '/api/public/items', file: 'src/api/index.ts' }],
    crons: ['reset-rate-buckets (hourly)'],
    totals: { symbols: 1, callers: 4, endpoints: 1, crons: 1 },
    prior_prs: [
      {
        id: 'x',
        number: 470,
        title: 'earlier',
        author: 'a',
        updated_at: '2026-08-01T00:00:00.000Z',
        overlapping_files: 2,
      },
    ],
    summary: '1 changed symbol · 4 callers · 1 endpoint · 1 cron/job',
  };

  it('round-trips a full payload', () => {
    expect(() => BlastRadiusResult.parse(valid)).not.toThrow();
  });

  it('rejects an unknown status — degraded/partial/ready is a closed set', () => {
    expect(() => BlastRadiusResult.parse({ ...valid, status: 'unknown' })).toThrow();
  });

  it('requires reason to be present (nullable, not optional)', () => {
    const { reason: _omitted, ...withoutReason } = valid;
    expect(() => BlastRadiusResult.parse(withoutReason)).toThrow();
  });

  it('carries no .default() — an omitted array must fail, not be silently filled', () => {
    const { symbols: _omitted, ...withoutSymbols } = valid;
    expect(() => BlastRadiusResult.parse(withoutSymbols)).toThrow();
  });
});
