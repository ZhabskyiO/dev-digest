import { stringify, parse } from 'yaml';
import { AgentManifest, type Agent } from '@devdigest/shared';

/**
 * Render `.devdigest/agents/<slug>.yaml` — the manifest the studio writes and
 * `agent-runner` reads (AC-16). Field order is FIXED (`name, provider, model,
 * system_prompt, skills, strategy, ci_fail_on`) and no timestamp/nonce is ever
 * embedded, so two calls with the same `agent`/`skillSlugs` are byte-identical
 * (AC-19).
 *
 * `skillSlugs` is written as-is — an agent with zero skills gets `skills: []`
 * rather than an omitted key, because `AgentManifest.skills` only recovers a
 * MISSING or explicit `null` value (YAML `skills:` with no value parses to
 * `null`), not an absent key with no fallback in every YAML dialect; passing
 * `[]` explicitly sidesteps the distinction entirely.
 *
 * Before returning, the rendered YAML is parsed back and validated against
 * `AgentManifest` — the same contract `agent-runner` validates against — so a
 * bundle can never ship a manifest that fails its own round-trip.
 */
export function renderManifest(agent: Agent, skillSlugs: readonly string[]): string {
  const doc = {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    skills: [...skillSlugs],
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
  };
  const contents = stringify(doc);
  // Throws if the emitted YAML doesn't round-trip through the contract both
  // ends validate against — a generation-time bug, never a runtime surprise.
  AgentManifest.parse(parse(contents));
  return contents;
}
