import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest, type Agent } from '@devdigest/shared';
import { renderManifest } from './manifest.js';

const AGENT: Agent = {
  id: 'agent-1',
  name: 'Security Reviewer',
  description: 'Flags secrets and injection risks',
  provider: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet',
  system_prompt: 'You are a careful security reviewer.\nBe concise.',
  output_schema: null,
  enabled: true,
  version: 3,
  strategy: 'single-pass',
  ci_fail_on: 'warning',
  repo_intel: true,
};

describe('renderManifest', () => {
  it('round-trips through AgentManifest.parse with every field equal to the agent record (AC-16)', () => {
    const yamlText = renderManifest(AGENT, ['security', 'style-guide']);
    const parsed = AgentManifest.parse(parse(yamlText));
    expect(parsed).toEqual({
      name: AGENT.name,
      provider: AGENT.provider,
      model: AGENT.model,
      system_prompt: AGENT.system_prompt,
      skills: ['security', 'style-guide'],
      strategy: AGENT.strategy,
      ci_fail_on: AGENT.ci_fail_on,
    });
  });

  it('emits skills: [] — not a bare key — for an agent with zero skills', () => {
    const yamlText = renderManifest(AGENT, []);
    const raw = parse(yamlText);
    expect(raw.skills).toEqual([]);
    expect(AgentManifest.parse(raw).skills).toEqual([]);
  });

  it('uses a fixed key order: name, provider, model, system_prompt, skills, strategy, ci_fail_on', () => {
    const yamlText = renderManifest(AGENT, ['security']);
    const keys = yamlText
      .split('\n')
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.split(':')[0]);
    expect(keys).toEqual([
      'name',
      'provider',
      'model',
      'system_prompt',
      'skills',
      'strategy',
      'ci_fail_on',
    ]);
  });

  it('never embeds a timestamp or nonce — identical inputs are byte-identical (AC-19)', () => {
    const a = renderManifest(AGENT, ['security']);
    const b = renderManifest(AGENT, ['security']);
    expect(a).toBe(b);
  });
});
