import { randomUUID } from 'node:crypto';
import type {
  CreateEvalCaseBody,
  UpdateEvalCaseBody,
  EvalCaseSeed,
  EvalBatch,
  EvalBatchResult,
  EvalCaseFromFinding,
  EvalCaseOutcome,
  EvalCaseSummary,
  EvalDashboardAgent,
  EvalPipelineDashboard,
  Provider,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { AgentRow, SkillRow } from '../../db/rows.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { EvalsRepository, type EvalCaseRow, type EvalRunRow, type InsertEvalRun } from './repository.js';
import {
  buildDiffFragment,
  decisionOf,
  expectationFromFinding,
  groupRunsIntoBatches,
  parseExpectation,
  slugifyCaseName,
  batchMetaOf,
} from './helpers.js';
import { scoreBatch, scoreCase } from './scoring.js';

/** Task line for an eval run — includes the case's simulated PR framing. */
function evalTaskLine(c: EvalCaseRow): string {
  const meta = c.inputMeta as { pr_meta?: { title?: string; body?: string } } | null;
  const title = meta?.pr_meta?.title?.trim();
  const body = meta?.pr_meta?.body?.trim();
  let task = `Regression eval case '${c.name}'.`;
  if (title) task += ` PR title: ${title}.`;
  if (body) task += ` PR description: ${body}`;
  return task;
}

/**
 * Eval pipeline (L07) — regression protection for review agents.
 *
 * Cases are born from real accept/dismiss decisions on findings; a run
 * executes the agent over every case with FIXED inputs — the stored diff
 * fragment plus the agent's own config (prompt, model, strategy, linked
 * skills). Deliberately NO repo-intel / project-context enrichment: those
 * depend on mutable index state, and comparability across agent versions is
 * the whole point. Scoring is pure code (`scoring.ts`), no model.
 */
export class EvalsService {
  private repo: EvalsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  // ---- cases --------------------------------------------------------------

  async createFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseFromFinding> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.review.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    if (!review.agentId) {
      throw new ValidationError('This finding was not produced by an agent, so it has no eval-set owner.');
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, review.agentId);
    if (!agent) throw new NotFoundError('The agent that produced this finding no longer exists');

    const decision = decisionOf(finding);
    if (!decision) {
      throw new ValidationError(
        'Accept or dismiss the finding first — the decision determines whether the case is must_find or must_not_flag.',
      );
    }

    const existing = await this.repo.caseByFinding(workspaceId, agent.id, findingId);
    if (existing) {
      return { case: await this.withLastRun(existing), created: false };
    }

    const prFiles = await this.container.reviewRepo.getPrFiles(pull.id);
    const file = prFiles.find((f) => f.path === finding.file);
    if (!file?.patch) {
      throw new ValidationError(
        `No stored diff patch for '${finding.file}' — cannot freeze an eval input for this finding.`,
      );
    }

    const name = await this.uniqueName(workspaceId, agent.id, slugifyCaseName(finding.title));
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name,
      inputDiff: buildDiffFragment(finding.file, file.patch),
      inputFiles: null,
      inputMeta: {
        source: 'finding',
        finding_id: finding.id,
        review_id: review.id,
        pr_id: pull.id,
        pr_number: pull.number,
        pr_title: pull.title,
        decision,
      },
      expectedOutput: expectationFromFinding(finding, decision),
      notes: `From ${decision} finding "${finding.title}" (${finding.file}:${finding.startLine})`,
    });
    return { case: this.toSummary(row, null), created: true };
  }

  /**
   * Dry-run of createFromFinding: everything the case editor needs to open
   * prefilled from a decided finding. Creates NOTHING.
   */
  async seedFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseSeed> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.review.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;
    if (!review.agentId) {
      throw new ValidationError('This finding was not produced by an agent, so it has no eval-set owner.');
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, review.agentId);
    if (!agent) throw new NotFoundError('The agent that produced this finding no longer exists');
    const decision = decisionOf(finding);
    if (!decision) {
      throw new ValidationError(
        'Accept or dismiss the finding first — the decision determines whether the case is must_find or must_not_flag.',
      );
    }
    const prFiles = await this.container.reviewRepo.getPrFiles(pull.id);
    const file = prFiles.find((f) => f.path === finding.file);
    if (!file?.patch) {
      throw new ValidationError(
        `No stored diff patch for '${finding.file}' — cannot freeze an eval input for this finding.`,
      );
    }
    const existing = await this.repo.caseByFinding(workspaceId, agent.id, findingId);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      name: `From finding: ${finding.title}`,
      input_diff: buildDiffFragment(finding.file, file.patch),
      expectation: expectationFromFinding(finding, decision),
      pr_meta: { title: pull.title, body: pull.body ?? '' },
      decision,
      existing_case_id: existing?.id ?? null,
    };
  }

  async createManual(
    workspaceId: string,
    agentId: string,
    body: CreateEvalCaseBody,
  ): Promise<EvalCaseSummary> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const name = await this.uniqueName(workspaceId, agentId, slugifyCaseName(body.name));
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name,
      inputDiff: body.input_diff,
      inputFiles: null,
      inputMeta: {
        source: body.source_finding_id ? 'finding' : 'manual',
        ...(body.source_finding_id ? { finding_id: body.source_finding_id } : {}),
        ...(body.pr_meta ? { pr_meta: body.pr_meta } : {}),
      },
      expectedOutput: body.expected_output,
      notes: body.notes ?? null,
    });
    return this.toSummary(row, null);
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseSummary[] | null> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return null;
    const rows = await this.repo.listCases(workspaceId, agentId);
    const runs = await this.repo.runsForCases(rows.map((r) => r.id));
    const latestByCase = new Map<string, EvalRunRow>();
    for (const run of runs) {
      if (!latestByCase.has(run.caseId)) latestByCase.set(run.caseId, run);
    }
    return rows.map((row) => this.toSummary(row, latestByCase.get(row.id) ?? null));
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  /** Edit a case in the case-editor modal. Renames re-slug + dedupe. */
  async updateCase(
    workspaceId: string,
    id: string,
    body: UpdateEvalCaseBody,
  ): Promise<EvalCaseSummary | null> {
    const row = await this.repo.getCase(workspaceId, id);
    if (!row) return null;
    let name = row.name;
    if (body.name !== undefined) {
      const slug = slugifyCaseName(body.name);
      if (slug !== row.name) name = await this.uniqueName(workspaceId, row.ownerId, slug);
    }
    const oldMeta =
      row.inputMeta && typeof row.inputMeta === 'object'
        ? (row.inputMeta as Record<string, unknown>)
        : {};
    const updated = await this.repo.updateCase(workspaceId, id, {
      name,
      ...(body.input_diff !== undefined ? { inputDiff: body.input_diff } : {}),
      ...(body.expected_output !== undefined ? { expectedOutput: body.expected_output } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.pr_meta !== undefined ? { inputMeta: { ...oldMeta, pr_meta: body.pr_meta } } : {}),
    });
    return updated ? this.withLastRun(updated) : null;
  }

  // ---- runs ---------------------------------------------------------------

  /**
   * Run the agent over every case of its set, score in code, persist one
   * `eval_runs` row per case stamped with a shared `batch_id`.
   */
  async run(
    workspaceId: string,
    agentId: string,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<EvalBatchResult> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const cases = await this.repo.listCases(workspaceId, agentId);
    if (cases.length === 0) {
      throw new ValidationError(
        'This agent has no eval cases yet. Turn accepted/dismissed findings into cases first.',
      );
    }

    // The agent's own linked+enabled skills ARE part of the config under test
    // ("changed the linked skill → run evals"), so they go into the prompt.
    const linked = await this.container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = linked.filter((l) => l.skill.enabled === true).map((l) => l.skill.body);
    const llm = await this.container.llm(agent.provider);

    const outcomes: EvalCaseOutcome[] = [];
    const errors = new Map<string, string>();
    for (const c of cases) {
      outcomes.push(await this.runCase(agent, c, llm, skillBodies, errors, logger));
    }

    const result = scoreBatch(outcomes);
    const batchId = randomUUID();
    const ranAt = new Date();

    const rows: InsertEvalRun[] = outcomes.map((o) => {
      const score = scoreCase(o.expectation, o.kept);
      return {
        caseId: o.case_id,
        ranAt,
        pass: score.pass,
        // Batch-level metrics duplicated per row: the schema has no batch
        // table, so any row of a batch can answer for the whole batch.
        recall: result.recall,
        precision: result.precision,
        citationAccuracy: result.citation_accuracy,
        durationMs: o.duration_ms,
        costUsd: o.cost_usd,
        actualOutput: {
          scope: 'set',
          batch_id: batchId,
          agent_id: agent.id,
          agent_version: agent.version,
          model: agent.model,
          provider: agent.provider,
          expectation_type: o.expectation?.type ?? null,
          findings: o.kept,
          dropped_count: o.dropped_count,
          matched: score.matched,
          noise: score.noise,
          ...(errors.has(o.case_id) ? { error: errors.get(o.case_id) } : {}),
        },
      };
    });
    await this.repo.insertRuns(rows);

    const batch: EvalBatch = {
      batch_id: batchId,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_version: agent.version,
      model: agent.model,
      provider: agent.provider as Provider,
      ran_at: ranAt.toISOString(),
      recall: result.recall,
      precision: result.precision,
      citation_accuracy: result.citation_accuracy,
      passed: result.traces_passed,
      total: result.traces_total,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
    };
    logger?.info(
      { agent: agent.name, batch: batchId, ...result, per_trace: undefined },
      `eval run: ${result.traces_passed}/${result.traces_total} passed`,
    );
    return { batch, result };
  }

  /**
   * Run ONE case (the play button / "Run case" in the editor). Persists a
   * single `eval_runs` row stamped `scope: 'case'` so the case's last-run
   * status updates without polluting the comparable batch history.
   */
  async runSingleCase(
    workspaceId: string,
    caseId: string,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<EvalBatchResult> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    if (row.ownerKind === 'skill') return this.runSingleSkillCase(workspaceId, row, logger);
    const agent = await this.container.agentsRepo.getById(workspaceId, row.ownerId);
    if (!agent) throw new NotFoundError('The agent owning this case no longer exists');

    const linked = await this.container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = linked.filter((l) => l.skill.enabled === true).map((l) => l.skill.body);
    const llm = await this.container.llm(agent.provider);

    const errors = new Map<string, string>();
    const outcome = await this.runCase(agent, row, llm, skillBodies, errors, logger);
    const result = scoreBatch([outcome]);
    const score = scoreCase(outcome.expectation, outcome.kept);
    const batchId = randomUUID();
    const ranAt = new Date();

    await this.repo.insertRuns([
      {
        caseId: row.id,
        ranAt,
        pass: score.pass,
        recall: result.recall,
        precision: result.precision,
        citationAccuracy: result.citation_accuracy,
        durationMs: outcome.duration_ms,
        costUsd: outcome.cost_usd,
        actualOutput: {
          scope: 'case',
          batch_id: batchId,
          agent_id: agent.id,
          agent_version: agent.version,
          model: agent.model,
          provider: agent.provider,
          expectation_type: outcome.expectation?.type ?? null,
          findings: outcome.kept,
          dropped_count: outcome.dropped_count,
          matched: score.matched,
          noise: score.noise,
          ...(errors.has(row.id) ? { error: errors.get(row.id) } : {}),
        },
      },
    ]);

    return {
      batch: {
        batch_id: batchId,
        agent_id: agent.id,
        agent_name: agent.name,
        agent_version: agent.version,
        model: agent.model,
        provider: agent.provider as Provider,
        ran_at: ranAt.toISOString(),
        recall: result.recall,
        precision: result.precision,
        citation_accuracy: result.citation_accuracy,
        passed: result.traces_passed,
        total: result.traces_total,
        duration_ms: result.duration_ms,
        cost_usd: result.cost_usd,
      },
      result,
    };
  }

  /** Batch history for an agent, newest first. */
  async history(workspaceId: string, agentId: string): Promise<EvalBatch[] | null> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return null;
    const rows = await this.repo.runsForAgent(workspaceId, agentId);
    return groupRunsIntoBatches(rows).map((b) => ({ ...b, agent_name: agent.name }));
  }

  // ---- skill-owned eval sets (owner_kind = 'skill') -----------------------

  /** Deterministic carrier: the reviewer the skill's cases run through. */
  private async carrierAgent(workspaceId: string): Promise<AgentRow> {
    const enabled = await this.container.agentsRepo.listEnabled(workspaceId);
    const carrier = [...enabled].sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!carrier) throw new ValidationError('No enabled agent to carry the skill eval. Enable one in Agents.');
    return carrier;
  }

  private async resolveSkill(workspaceId: string, skillId: string): Promise<SkillRow | undefined> {
    return this.container.skillsRepo.getById(workspaceId, skillId);
  }

  async listSkillCases(workspaceId: string, skillId: string): Promise<EvalCaseSummary[] | null> {
    const skill = await this.resolveSkill(workspaceId, skillId);
    if (!skill) return null;
    const rows = await this.repo.listCases(workspaceId, skillId, 'skill');
    const runs = await this.repo.runsForCases(rows.map((r) => r.id));
    const latestByCase = new Map<string, EvalRunRow>();
    for (const run of runs) {
      if (!latestByCase.has(run.caseId)) latestByCase.set(run.caseId, run);
    }
    return rows.map((row) => this.toSummary(row, latestByCase.get(row.id) ?? null));
  }

  async createSkillManual(
    workspaceId: string,
    skillId: string,
    body: CreateEvalCaseBody,
  ): Promise<EvalCaseSummary | null> {
    const skill = await this.resolveSkill(workspaceId, skillId);
    if (!skill) return null;
    const names = new Set((await this.repo.listCases(workspaceId, skillId, 'skill')).map((c) => c.name));
    let name = slugifyCaseName(body.name);
    let i = 2;
    while (names.has(name)) name = `${slugifyCaseName(body.name)}-${i++}`;
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'skill',
      ownerId: skillId,
      name,
      inputDiff: body.input_diff,
      inputFiles: null,
      inputMeta: { source: 'manual', ...(body.pr_meta ? { pr_meta: body.pr_meta } : {}) },
      expectedOutput: body.expected_output,
      notes: body.notes ?? null,
    });
    return this.toSummary(row, null);
  }

  /**
   * Run a SKILL's case set as a with-vs-without benchmark: every case runs
   * twice through a deterministic carrier agent — once with ONLY this skill
   * injected, once with no skills at all. Primary metrics = the with-skill
   * pass; the baseline aggregate is stamped alongside, so the tab can show
   * "With skill X% / Without skill Y%" (the skill's measured lift).
   */
  async runSkill(
    workspaceId: string,
    skillId: string,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<EvalBatchResult> {
    const skill = await this.resolveSkill(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const cases = await this.repo.listCases(workspaceId, skillId, 'skill');
    if (cases.length === 0) {
      throw new ValidationError('This skill has no eval cases yet. Create one in the Evals tab first.');
    }
    const carrier = await this.carrierAgent(workspaceId);
    const llm = await this.container.llm(carrier.provider);

    const withOutcomes: EvalCaseOutcome[] = [];
    const withoutOutcomes: EvalCaseOutcome[] = [];
    const errors = new Map<string, string>();
    for (const c of cases) {
      withOutcomes.push(await this.runCase(carrier, c, llm, [skill.body], errors, logger));
      withoutOutcomes.push(await this.runCase(carrier, c, llm, [], errors, logger));
    }

    const result = scoreBatch(withOutcomes);
    const baselineResult = scoreBatch(withoutOutcomes);
    const batchId = randomUUID();
    const ranAt = new Date();
    const batchBaseline = {
      recall: baselineResult.recall,
      precision: baselineResult.precision,
      citation_accuracy: baselineResult.citation_accuracy,
      passed: baselineResult.traces_passed,
      total: baselineResult.traces_total,
    };

    const rows: InsertEvalRun[] = withOutcomes.map((o, idx) => {
      const score = scoreCase(o.expectation, o.kept);
      const baseScore = scoreCase(withoutOutcomes[idx]!.expectation, withoutOutcomes[idx]!.kept);
      return {
        caseId: o.case_id,
        ranAt,
        pass: score.pass,
        recall: result.recall,
        precision: result.precision,
        citationAccuracy: result.citation_accuracy,
        durationMs: o.duration_ms + withoutOutcomes[idx]!.duration_ms,
        costUsd:
          o.cost_usd == null || withoutOutcomes[idx]!.cost_usd == null
            ? null
            : o.cost_usd + withoutOutcomes[idx]!.cost_usd!,
        actualOutput: {
          scope: 'set',
          batch_id: batchId,
          agent_id: carrier.id,
          skill_id: skill.id,
          // For a skill set, the comparable version axis is the SKILL's version.
          agent_version: skill.version,
          model: carrier.model,
          provider: carrier.provider,
          expectation_type: o.expectation?.type ?? null,
          findings: o.kept,
          dropped_count: o.dropped_count,
          matched: score.matched,
          noise: score.noise,
          baseline: {
            pass: baseScore.pass,
            matched: baseScore.matched,
            noise: baseScore.noise,
            findings_count: withoutOutcomes[idx]!.kept.length,
          },
          batch_baseline: batchBaseline,
          ...(errors.has(o.case_id) ? { error: errors.get(o.case_id) } : {}),
        },
      };
    });
    await this.repo.insertRuns(rows);

    return {
      batch: {
        batch_id: batchId,
        agent_id: carrier.id,
        agent_name: carrier.name,
        agent_version: skill.version,
        model: carrier.model,
        provider: carrier.provider as Provider,
        ran_at: ranAt.toISOString(),
        recall: result.recall,
        precision: result.precision,
        citation_accuracy: result.citation_accuracy,
        passed: result.traces_passed,
        total: result.traces_total,
        duration_ms: result.duration_ms + baselineResult.duration_ms,
        cost_usd:
          result.cost_usd == null || baselineResult.cost_usd == null
            ? null
            : result.cost_usd + baselineResult.cost_usd,
        skill_id: skill.id,
        baseline: batchBaseline,
      },
      result,
    };
  }

  async skillHistory(workspaceId: string, skillId: string): Promise<EvalBatch[] | null> {
    const skill = await this.resolveSkill(workspaceId, skillId);
    if (!skill) return null;
    const rows = await this.repo.runsForAgent(workspaceId, skillId, 500, 'skill');
    return groupRunsIntoBatches(rows).map((b) => ({ ...b, agent_name: skill.name }));
  }

  // ---- dashboard ----------------------------------------------------------

  async dashboard(workspaceId: string): Promise<EvalPipelineDashboard> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    const agentRows: EvalDashboardAgent[] = [];
    const recent: EvalBatch[] = [];

    for (const a of agents) {
      const casesTotal = await this.repo.countCases(workspaceId, a.id);
      const runRows = await this.repo.runsForAgent(workspaceId, a.id);
      const batches = groupRunsIntoBatches(runRows).map((b) => ({ ...b, agent_name: a.name }));
      if (casesTotal === 0 && batches.length === 0) continue;

      const latest = batches[0] ?? null;
      const prev = batches[1];
      const delta =
        latest && prev
          ? {
              recall: (latest.recall ?? 0) - (prev.recall ?? 0),
              precision: (latest.precision ?? 0) - (prev.precision ?? 0),
              citation_accuracy: (latest.citation_accuracy ?? 0) - (prev.citation_accuracy ?? 0),
            }
          : null;
      agentRows.push({
        agent_id: a.id,
        agent_name: a.name,
        model: a.model,
        enabled: a.enabled,
        cases_total: casesTotal,
        latest,
        delta,
        trend: [...batches].reverse().map((b) => b.recall ?? 0).slice(-12),
      });
      recent.push(...batches.slice(0, 5));
    }

    recent.sort((x, y) => (x.ran_at < y.ran_at ? 1 : -1));
    return { agents: agentRows, recent: recent.slice(0, 8) };
  }

  // ---- internals ----------------------------------------------------------

  private async runSingleSkillCase(
    workspaceId: string,
    row: EvalCaseRow,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<EvalBatchResult> {
    const skill = await this.resolveSkill(workspaceId, row.ownerId);
    if (!skill) throw new NotFoundError('The skill owning this case no longer exists');
    const carrier = await this.carrierAgent(workspaceId);
    const llm = await this.container.llm(carrier.provider);
    const errors = new Map<string, string>();
    const withOutcome = await this.runCase(carrier, row, llm, [skill.body], errors, logger);
    const withoutOutcome = await this.runCase(carrier, row, llm, [], errors, logger);
    const result = scoreBatch([withOutcome]);
    const score = scoreCase(withOutcome.expectation, withOutcome.kept);
    const baseScore = scoreCase(withoutOutcome.expectation, withoutOutcome.kept);
    const batchId = randomUUID();
    const ranAt = new Date();
    await this.repo.insertRuns([
      {
        caseId: row.id,
        ranAt,
        pass: score.pass,
        recall: result.recall,
        precision: result.precision,
        citationAccuracy: result.citation_accuracy,
        durationMs: withOutcome.duration_ms + withoutOutcome.duration_ms,
        costUsd:
          withOutcome.cost_usd == null || withoutOutcome.cost_usd == null
            ? null
            : withOutcome.cost_usd + withoutOutcome.cost_usd,
        actualOutput: {
          scope: 'case',
          batch_id: batchId,
          agent_id: carrier.id,
          skill_id: skill.id,
          agent_version: skill.version,
          model: carrier.model,
          provider: carrier.provider,
          expectation_type: withOutcome.expectation?.type ?? null,
          findings: withOutcome.kept,
          dropped_count: withOutcome.dropped_count,
          matched: score.matched,
          noise: score.noise,
          baseline: {
            pass: baseScore.pass,
            matched: baseScore.matched,
            noise: baseScore.noise,
            findings_count: withoutOutcome.kept.length,
          },
          ...(errors.has(row.id) ? { error: errors.get(row.id) } : {}),
        },
      },
    ]);
    return {
      batch: {
        batch_id: batchId,
        agent_id: carrier.id,
        agent_name: carrier.name,
        agent_version: skill.version,
        model: carrier.model,
        provider: carrier.provider as Provider,
        ran_at: ranAt.toISOString(),
        recall: result.recall,
        precision: result.precision,
        citation_accuracy: result.citation_accuracy,
        passed: result.traces_passed,
        total: result.traces_total,
        duration_ms: withOutcome.duration_ms + withoutOutcome.duration_ms,
        cost_usd: null,
        skill_id: skill.id,
        baseline: {
          recall: null,
          precision: null,
          citation_accuracy: null,
          passed: baseScore.pass ? 1 : 0,
          total: 1,
        },
      },
      result,
    };
  }

  private async runCase(
    agent: AgentRow,
    c: EvalCaseRow,
    llm: Awaited<ReturnType<Container['llm']>>,
    skillBodies: string[],
    errors: Map<string, string>,
    logger?: { info: (obj: unknown, msg?: string) => void },
  ): Promise<EvalCaseOutcome> {
    const expectation = parseExpectation(c.expectedOutput);
    const base = {
      case_id: c.id,
      name: c.name,
      expectation,
    };
    const diff = parseUnifiedDiff(c.inputDiff ?? '');
    if (diff.files.length === 0) {
      // A broken input can never pass, but must not sink the whole batch.
      errors.set(c.id, 'input_diff_unparseable');
      return { ...base, kept: [], dropped_count: 0, duration_ms: 0, cost_usd: 0 };
    }

    const started = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy ?? 'single-pass',
      // Fail fast: eval inputs are small and a wedged upstream must not spin
      // the UI for minutes. 45s per network attempt, 1 reprompt, SDK retries
      // capped by the provider when timeoutMs is set → worst case ≈ 3 min,
      // typical seconds.
      llmTimeoutMs: 45_000,
      maxRetries: 1,
      ...(skillBodies.length ? { skills: skillBodies } : {}),
      task: evalTaskLine(c),
      sessionId: `eval:${agent.name}:${c.name}`,
      onEvent: (e) => logger?.info({ kind: e.kind, case: c.name }, e.msg),
    });
    return {
      ...base,
      kept: outcome.review.findings,
      dropped_count: outcome.dropped.length,
      duration_ms: Date.now() - started,
      cost_usd: outcome.costUsd,
    };
  }

  private toSummary(row: EvalCaseRow, lastRun: EvalRunRow | null): EvalCaseSummary {
    const out = (lastRun?.actualOutput ?? null) as Record<string, unknown> | null;
    const baseline = out?.['baseline'] as { pass?: boolean } | undefined;
    return {
      id: row.id,
      agent_id: row.ownerId,
      owner_kind: row.ownerKind as 'agent' | 'skill',
      name: row.name,
      input_diff: row.inputDiff ?? '',
      expectation: parseExpectation(row.expectedOutput),
      notes: row.notes ?? null,
      meta: row.inputMeta,
      last_run: lastRun
        ? {
            run_id: lastRun.id,
            ran_at: lastRun.ranAt.toISOString(),
            pass: lastRun.pass,
            findings_count: batchMetaOf(lastRun)?.findings_count ?? null,
            matched: typeof out?.['matched'] === 'number' ? (out['matched'] as number) : null,
            baseline_pass: typeof baseline?.pass === 'boolean' ? baseline.pass : null,
          }
        : null,
    };
  }

  private async withLastRun(row: EvalCaseRow): Promise<EvalCaseSummary> {
    const runs = await this.repo.runsForCases([row.id]);
    return this.toSummary(row, runs[0] ?? null);
  }

  /** Keep case names unique per agent set: slug, slug-2, slug-3, … */
  private async uniqueName(workspaceId: string, agentId: string, base: string): Promise<string> {
    const names = new Set((await this.repo.listCases(workspaceId, agentId)).map((c) => c.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base}-${i}`)) i += 1;
    return `${base}-${i}`;
  }
}
