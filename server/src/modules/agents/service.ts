import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentRunStats,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { MAX_TREND_DAYS } from './constants.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /**
   * Re-apply an old config snapshot as a NEW version — never rewinds history,
   * so past eval runs keep the exact version they were scored against (same
   * contract as skill restore). Restores the core config fields; linked skills
   * and context attachments are managed by their own endpoints and stay as
   * they are.
   */
  async restoreVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<Agent | undefined> {
    const snapshot = await this.getVersion(workspaceId, agentId, version);
    if (!snapshot) return undefined;
    const c = snapshot.config;
    return this.update(workspaceId, agentId, {
      provider: c.provider,
      model: c.model,
      system_prompt: c.system_prompt,
      output_schema: c.output_schema ?? null,
      strategy: c.strategy,
      ci_fail_on: c.ci_fail_on,
      repo_intel: c.repo_intel,
    });
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /** Unlink a single skill from an agent. Returns the resulting ordered links,
   *  or undefined if the agent isn't in this workspace. */
  async unlinkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.unlinkSkill(agentId, skillId);
    return this.skillLinks(agentId);
  }

  /**
   * Aggregate run stats for the AgentCard summary row and the editor Stats
   * tab's KPI tiles. Workspace-scoped: undefined when the agent isn't in this
   * workspace (route → 404). `days` windows the aggregation (the Stats tab
   * passes 30 to match its "(30D)" label); omitted → all-time, which is what
   * the AgentCard summary row shows.
   */
  async runStats(
    workspaceId: string,
    agentId: string,
    days?: number,
  ): Promise<AgentRunStats | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const raw = await this.repo.runStats(agentId, days);

    // Trend/delta are only meaningful within a bounded window — clamp so an
    // absurd ?days= can't allocate an equally absurd trend array or scan an
    // unbounded second window for the delta.
    const trendDays = days !== undefined ? Math.min(days, MAX_TREND_DAYS) : undefined;
    const [trend, avgCostUsdDelta] =
      trendDays !== undefined
        ? await Promise.all([
            this.repo.dailyRunCounts(agentId, trendDays),
            this.repo.avgCostDelta(agentId, trendDays),
          ])
        : [[], null];

    return {
      runs: raw.runs,
      accept_rate:
        raw.reviewedRuns > 0 ? Math.round((raw.approvedRuns / raw.reviewedRuns) * 100) : null,
      avg_cost_usd: raw.avgCostUsd,
      avg_cost_usd_delta: avgCostUsdDelta,
      avg_duration_ms: raw.avgDurationMs,
      trend,
    };
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
