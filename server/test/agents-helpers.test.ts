import { describe, it, expect } from 'vitest';
import { isConfigChange, toAgentVersionDto } from '../src/modules/agents/helpers.js';
import type { AgentVersionRow } from '../src/db/rows.js';

/**
 * Unit coverage for the agents module's pure helpers — the config-version-bump
 * rule (`isConfigChange`, incl. the AC-19 attachment dimension) and the
 * `agent_versions` row → DTO mapping (`toAgentVersionDto`).
 */

describe('isConfigChange', () => {
  const existing = {
    name: 'Agent',
    description: 'desc',
    provider: 'openai' as const,
    model: 'gpt-4.1',
    systemPrompt: 'You review code.',
    strategy: 'single-pass' as const,
    ciFailOn: 'critical' as const,
    repoIntel: true,
    context: [{ repo_id: 'r1', path: 'specs/a.md' }],
  };

  it('returns true when only the ordered attachment list differs', () => {
    expect(
      isConfigChange(existing, { context: [{ repo_id: 'r1', path: 'specs/b.md' }] }),
    ).toBe(true);
  });

  it('returns true when the attachment set is reordered (order-sensitive)', () => {
    const reordered = [
      { repo_id: 'r1', path: 'specs/b.md' },
      { repo_id: 'r1', path: 'specs/a.md' },
    ];
    const sameOrder = [
      { repo_id: 'r1', path: 'specs/a.md' },
      { repo_id: 'r1', path: 'specs/b.md' },
    ];
    expect(
      isConfigChange({ ...existing, context: sameOrder }, { context: reordered }),
    ).toBe(true);
  });

  it('returns false when the ordered attachment list is unchanged', () => {
    expect(
      isConfigChange(existing, { context: [{ repo_id: 'r1', path: 'specs/a.md' }] }),
    ).toBe(false);
  });

  it('returns false when the patch omits context entirely (untouched)', () => {
    expect(isConfigChange(existing, { name: 'Agent' })).toBe(false);
  });

  it('still detects a non-attachment field change unrelated to context', () => {
    expect(isConfigChange(existing, { name: 'Renamed' })).toBe(true);
  });
});

describe('toAgentVersionDto', () => {
  const baseRow: AgentVersionRow = {
    agentId: 'a1',
    version: 1,
    configJson: {
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'You review code.',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: ['s1'],
      context: [{ repo_id: 'r1', path: 'specs/a.md' }],
    },
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
  };

  it('parses a snapshot that already carries context', () => {
    const dto = toAgentVersionDto(baseRow);
    expect(dto.config.context).toEqual([{ repo_id: 'r1', path: 'specs/a.md' }]);
  });

  it('defaults context to [] for a legacy snapshot lacking the field', () => {
    const legacyConfigJson = { ...baseRow.configJson } as Record<string, unknown>;
    delete legacyConfigJson.context;
    const legacyRow: AgentVersionRow = { ...baseRow, configJson: legacyConfigJson };

    const dto = toAgentVersionDto(legacyRow);
    expect(dto.config.context).toEqual([]);
  });
});
