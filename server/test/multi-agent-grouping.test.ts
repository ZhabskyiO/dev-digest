import { describe, it, expect } from 'vitest';
import { buildLocationGroups, type GroupingColumn, type GroupingRejection } from '../src/modules/multi-agent/grouping.js';
import type { AgentColumnFinding } from '@devdigest/shared';

/**
 * T5 — pure cross-agent grouper. No mock LLM is constructed anywhere in this
 * file: `buildLocationGroups` takes plain data in, plain data out.
 */

let findingSeq = 0;

function finding(overrides: Partial<AgentColumnFinding> & { file: string; start_line: number; end_line?: number }): AgentColumnFinding {
  findingSeq += 1;
  return {
    id: `f-${findingSeq}`,
    severity: 'WARNING',
    category: 'correctness',
    title: `Finding ${findingSeq}`,
    file: overrides.file,
    start_line: overrides.start_line,
    end_line: overrides.end_line ?? overrides.start_line,
    confidence: 0.9,
    rationale: 'because',
    suggestion: null,
    kind: null,
    review_id: 'rev-1',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function column(overrides: Partial<GroupingColumn> & { agent_id: string; agent_name: string }): GroupingColumn {
  return {
    // Defaults to the same value as `agent_id` so every existing fixture in
    // this file (which never sets `run_id`) keeps its prior merge/rejection
    // identity unchanged — override explicitly to give two columns distinct
    // run identities even when they share an `agent_id` (e.g. two
    // deleted-agent columns, both `agent_id: ''`).
    run_id: overrides.agent_id,
    status: 'done',
    findings: [],
    ...overrides,
  };
}

describe('buildLocationGroups', () => {
  it('groups two findings from different agents in the same file with intersecting ranges (AC-25)', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14 })],
    });
    const b = column({
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      findings: [finding({ file: 'a.ts', start_line: 12, end_line: 20 })],
    });

    const conflicts = buildLocationGroups({ columns: [a, b], rejections: new Map() });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('a.ts');
    expect(conflicts[0]!.start_line).toBe(10);
    expect(conflicts[0]!.end_line).toBe(20);
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('does not group two findings in the same file whose ranges do not intersect (AC-25)', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14 })],
    });
    const b = column({
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      findings: [finding({ file: 'a.ts', start_line: 30, end_line: 30 })],
    });

    const conflicts = buildLocationGroups({ columns: [a, b], rejections: new Map() });

    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => [c.start_line, c.end_line])).toEqual([
      [10, 14],
      [30, 30],
    ]);
  });

  it('does not group two findings at the same line in different files (AC-25)', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 10 })],
    });
    const b = column({
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      findings: [finding({ file: 'b.ts', start_line: 10, end_line: 10 })],
    });

    const conflicts = buildLocationGroups({ columns: [a, b], rejections: new Map() });

    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => c.file).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('never groups two findings from the same agent run — each stays its own entry (AC-26)', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [
        finding({ file: 'a.ts', start_line: 10, end_line: 10 }),
        finding({ file: 'a.ts', start_line: 10, end_line: 10 }),
      ],
    });

    const conflicts = buildLocationGroups({ columns: [a], rejections: new Map() });

    expect(conflicts).toHaveLength(2);
    for (const conflict of conflicts) {
      const agentIds = conflict.takes.map((t) => t.agent_id);
      expect(new Set(agentIds).size).toBe(agentIds.length);
    }
  });

  it('handles the transitive three-agent merge case (a.ts:10-14, a.ts:12-20, a.ts:18-25 -> one group)', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14 })],
    });
    const b = column({
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      findings: [finding({ file: 'a.ts', start_line: 12, end_line: 20 })],
    });
    const c = column({
      agent_id: 'agent-c',
      agent_name: 'Agent C',
      findings: [finding({ file: 'a.ts', start_line: 18, end_line: 25 })],
    });

    const conflicts = buildLocationGroups({ columns: [a, b, c], rejections: new Map() });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.start_line).toBe(10);
    expect(conflicts[0]!.end_line).toBe(25);
    expect(conflicts[0]!.takes).toHaveLength(3);
    expect(conflicts[0]!.takes.every((t) => t.verdict !== 'ignored')).toBe(true);
  });

  it('emits one group with 4 takes (3 ignored) when one of 4 done agents flags (AC-27)', () => {
    const flagger = column({
      agent_id: 'agent-1',
      agent_name: 'Agent 1',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 10, severity: 'CRITICAL' })],
    });
    const silent2 = column({ agent_id: 'agent-2', agent_name: 'Agent 2', findings: [] });
    const silent3 = column({ agent_id: 'agent-3', agent_name: 'Agent 3', findings: [] });
    const silent4 = column({ agent_id: 'agent-4', agent_name: 'Agent 4', findings: [] });

    const conflicts = buildLocationGroups({
      columns: [flagger, silent2, silent3, silent4],
      rejections: new Map(),
    });

    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    expect(takes).toHaveLength(4);
    const ignored = takes.filter((t) => t.verdict === 'ignored');
    expect(ignored).toHaveLength(3);
    const flaggerTake = takes.find((t) => t.agent_id === 'agent-1');
    expect(flaggerTake?.verdict).toBe('CRITICAL');
  });

  it('excludes failed and cancelled columns entirely — they contribute no take to any group (AC-28)', () => {
    const done = column({
      agent_id: 'agent-1',
      agent_name: 'Agent 1',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 10 })],
    });
    const failed = column({
      agent_id: 'agent-2',
      agent_name: 'Agent 2',
      status: 'failed',
      findings: [],
    });
    const cancelled = column({
      agent_id: 'agent-3',
      agent_name: 'Agent 3',
      status: 'cancelled',
      findings: [],
    });

    const conflicts = buildLocationGroups({ columns: [done, failed, cancelled], rejections: new Map() });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(1);
    expect(conflicts[0]!.takes[0]!.agent_id).toBe('agent-1');
    expect(conflicts[0]!.takes.some((t) => t.agent_id === 'agent-2' || t.agent_id === 'agent-3')).toBe(
      false,
    );
  });

  it('returns no groups at all when there are zero done columns (AC-28)', () => {
    const failed = column({ agent_id: 'agent-1', agent_name: 'Agent 1', status: 'failed', findings: [] });
    const running = column({ agent_id: 'agent-2', agent_name: 'Agent 2', status: 'running', findings: [] });

    const conflicts = buildLocationGroups({ columns: [failed, running], rejections: new Map() });

    expect(conflicts).toEqual([]);
  });

  it('every take and every finding carries exactly one agent_id (AC-30)', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14 })],
    });
    const b = column({
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      findings: [finding({ file: 'a.ts', start_line: 12, end_line: 20 })],
    });

    const conflicts = buildLocationGroups({ columns: [a, b], rejections: new Map() });

    for (const conflict of conflicts) {
      for (const take of conflict.takes) {
        expect(typeof take.agent_id).toBe('string');
        expect(take.agent_id.length).toBeGreaterThan(0);
      }
    }
  });

  it('an ignored take gets note = matching rejection reason at the grouped location, else null (AC-50)', () => {
    const flagger = column({
      agent_id: 'agent-1',
      agent_name: 'Agent 1',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14, severity: 'WARNING' })],
    });
    const silentWithRejection = column({ agent_id: 'agent-2', agent_name: 'Agent 2', findings: [] });
    const silentWithoutMatch = column({ agent_id: 'agent-3', agent_name: 'Agent 3', findings: [] });

    const rejections = new Map<string, GroupingRejection[]>([
      [
        'agent-2',
        [{ file: 'a.ts', start_line: 11, end_line: 13, reason: 'no grounded diff line' }],
      ],
      [
        'agent-3',
        [{ file: 'a.ts', start_line: 50, end_line: 60, reason: 'unrelated location' }],
      ],
    ]);

    const conflicts = buildLocationGroups({
      columns: [flagger, silentWithRejection, silentWithoutMatch],
      rejections,
    });

    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    const matched = takes.find((t) => t.agent_id === 'agent-2');
    const unmatched = takes.find((t) => t.agent_id === 'agent-3');
    expect(matched?.verdict).toBe('ignored');
    expect(matched?.note).toBe('no grounded diff line');
    expect(unmatched?.verdict).toBe('ignored');
    expect(unmatched?.note).toBeNull();
  });

  it('worst severity wins when a single agent has several members merged into one group', () => {
    const a = column({
      agent_id: 'agent-a',
      agent_name: 'Agent A',
      findings: [
        finding({ file: 'a.ts', start_line: 10, end_line: 10, severity: 'WARNING' }),
        finding({ file: 'a.ts', start_line: 15, end_line: 15, severity: 'CRITICAL' }),
      ],
    });
    const bridge = column({
      agent_id: 'agent-b',
      agent_name: 'Agent B',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 15, severity: 'SUGGESTION' })],
    });

    const conflicts = buildLocationGroups({ columns: [a, bridge], rejections: new Map() });

    expect(conflicts).toHaveLength(1);
    const takeA = conflicts[0]!.takes.find((t) => t.agent_id === 'agent-a');
    expect(takeA?.verdict).toBe('CRITICAL');
  });

  it('two deleted-agent columns (agent_id: \'\') merge and get distinct takes when their run_ids differ (Finding 2)', () => {
    const deletedOne = column({
      run_id: 'run-1',
      agent_id: '',
      agent_name: 'Unknown agent',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14, severity: 'WARNING' })],
    });
    const deletedTwo = column({
      run_id: 'run-2',
      agent_id: '',
      agent_name: 'Unknown agent',
      findings: [finding({ file: 'a.ts', start_line: 12, end_line: 20, severity: 'CRITICAL' })],
    });

    const conflicts = buildLocationGroups({ columns: [deletedOne, deletedTwo], rejections: new Map() });

    // The two runs' findings intersect and come from different runs, so they
    // merge into ONE group with TWO distinct takes — not one collapsed
    // pseudo-agent take, even though `agent_id` is `''` on both.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(2);
    const verdicts = conflicts[0]!.takes.map((t) => t.verdict).sort();
    expect(verdicts).toEqual(['CRITICAL', 'WARNING']);
  });

  it('never groups two findings from the SAME run (same run_id) even when agent_id is shared (\'\')', () => {
    const deleted = column({
      run_id: 'run-1',
      agent_id: '',
      agent_name: 'Unknown agent',
      findings: [
        finding({ file: 'a.ts', start_line: 10, end_line: 10 }),
        finding({ file: 'a.ts', start_line: 10, end_line: 10 }),
      ],
    });

    const conflicts = buildLocationGroups({ columns: [deleted], rejections: new Map() });

    expect(conflicts).toHaveLength(2);
  });

  it('rejections are keyed by run_id, so two deleted-agent columns each get their own rejection note (Finding 2)', () => {
    const flagger = column({
      agent_id: 'agent-1',
      agent_name: 'Agent 1',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 14, severity: 'WARNING' })],
    });
    const deletedOne = column({ run_id: 'run-x1', agent_id: '', agent_name: 'Unknown agent', findings: [] });
    const deletedTwo = column({ run_id: 'run-x2', agent_id: '', agent_name: 'Unknown agent', findings: [] });

    const rejections = new Map<string, GroupingRejection[]>([
      ['run-x1', [{ file: 'a.ts', start_line: 11, end_line: 13, reason: 'reason for run-x1' }]],
      ['run-x2', [{ file: 'a.ts', start_line: 50, end_line: 60, reason: 'unrelated location' }]],
    ]);

    const conflicts = buildLocationGroups({
      columns: [flagger, deletedOne, deletedTwo],
      rejections,
    });

    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    expect(takes.filter((t) => t.agent_id === '')).toHaveLength(2);
    const notes = takes.filter((t) => t.agent_id === '').map((t) => t.note).sort();
    expect(notes).toEqual([null, 'reason for run-x1']);
  });

  it('is deterministic: sorts groups by (file, start_line, end_line) and takes by agent_name', () => {
    const a = column({
      agent_id: 'agent-z',
      agent_name: 'Zed',
      findings: [
        finding({ file: 'b.ts', start_line: 5, end_line: 5 }),
        finding({ file: 'a.ts', start_line: 30, end_line: 30 }),
      ],
    });
    const b = column({
      agent_id: 'agent-a',
      agent_name: 'Alice',
      findings: [finding({ file: 'a.ts', start_line: 10, end_line: 10 })],
    });

    const conflicts = buildLocationGroups({ columns: [a, b], rejections: new Map() });

    expect(conflicts.map((c) => `${c.file}:${c.start_line}`)).toEqual(['a.ts:10', 'a.ts:30', 'b.ts:5']);
    for (const conflict of conflicts) {
      const names = conflict.takes.map((t) => t.agent_name);
      expect(names).toEqual([...names].sort());
    }
  });
});
