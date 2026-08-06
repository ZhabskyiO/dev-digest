import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ConventionCandidateDetail,
  ConventionExtractResult,
  ConventionStatus,
  CreateSkillFromConventionsRequest,
  ExtractedConvention,
  Skill,
} from '@devdigest/shared';
import { ConventionExtraction } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { renderPrompt } from '../../platform/prompts.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { toSkillDto } from '../skills/helpers.js';
import { ConventionsRepository } from './repository.js';
import {
  normalizeRule,
  numberLines,
  toConventionDto,
  verifyCandidates,
} from './helpers.js';
import {
  CONFIG_FILES,
  MAX_CONFIG_CHARS,
  MAX_SAMPLE_LINES,
  SAMPLE_FILE_COUNT,
} from './constants.js';

/**
 * Convention extraction: sample the clone in code, ask the model for candidate
 * house-rules once, then verify every citation against the sampled bytes before
 * anything is persisted.
 *
 * The split is deliberate. File selection is deterministic (config allowlist +
 * repo-intel's rank order), so two scans of the same commit see the same input;
 * and evidence checking is deterministic too, so a hallucinated citation is
 * dropped by code rather than by asking the model whether it was telling the
 * truth. The model's only job is proposing the rules in between.
 */

export interface SkillFromConventions {
  skill: Skill;
  linked_agent_id: string | null;
  accepted: number;
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(
    workspaceId: string,
    repoId: string,
    status?: ConventionStatus,
  ): Promise<ConventionCandidateDetail[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId, status);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: ConventionCandidateDetail['category'] },
  ): Promise<ConventionCandidateDetail | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      // Editing the rule re-derives its dedupe key, otherwise a later scan would
      // match the ORIGINAL wording and re-propose what the user just reworded.
      ...(patch.rule !== undefined
        ? { rule: patch.rule, ruleKey: normalizeRule(patch.rule) }
        : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
    });
    return row ? toConventionDto(row) : undefined;
  }

  // ---- extraction ---------------------------------------------------------

  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!repo.clonePath) {
      throw new ValidationError('Repo has not been cloned yet');
    }

    // Deterministic sample — no model involved in choosing what to read.
    const paths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    const files = await readSampleFiles(repo.clonePath, paths);

    if (files.size === 0) {
      // getConventionSamples returns [] for an unindexed repo (or when repo
      // intel is disabled). Report it instead of guessing at a file list — the
      // fix is a re-sync, which the UI can offer.
      return {
        candidates: await this.list(workspaceId, repoId),
        sampled_files: [],
        dropped: 0,
        duplicates: 0,
        cost_usd: null,
        degraded: true,
        reason: 'not_indexed',
      };
    }

    const configs = await readConfigFiles(repo.clonePath);

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);

    const prompt = await renderPrompt('conventions.extract.md', {
      repo: repo.fullName,
      configs: renderSample(configs),
      files: renderSample([...files].map(([path, lines]) => [path, numberLines(lines, MAX_SAMPLE_LINES)])),
    });

    const res = await llm.completeStructured<ConventionExtraction>({
      model,
      schema: ConventionExtraction,
      schemaName: 'ConventionExtraction',
      messages: [{ role: 'user', content: prompt }],
    });

    const proposals: ExtractedConvention[] = res.data.conventions;
    const known = await this.repo.existingRuleKeys(repoId);
    const { kept, dropped, duplicates } = verifyCandidates(files, proposals, known);

    await this.repo.insertMany(
      kept.map((c) => ({
        workspaceId,
        repoId,
        category: c.category,
        rule: c.rule,
        ruleKey: c.ruleKey,
        evidencePath: c.evidencePath,
        evidenceLine: c.evidenceLine,
        evidenceSnippet: c.evidenceSnippet,
        confidence: c.confidence,
      })),
    );

    return {
      candidates: await this.list(workspaceId, repoId),
      sampled_files: [...files.keys()],
      dropped,
      duplicates,
      cost_usd: res.costUsd,
    };
  }

  // ---- accepted candidates → skill ---------------------------------------

  async createSkill(
    workspaceId: string,
    repoId: string,
    input: CreateSkillFromConventionsRequest,
  ): Promise<SkillFromConventions> {
    const candidates = await this.repo.listByIds(workspaceId, repoId, input.candidate_ids);
    if (candidates.length === 0) throw new NotFoundError('No such conventions in this repo');

    const evidenceFiles = [
      ...new Set(candidates.map((c) => c.evidencePath).filter((p): p is string => !!p)),
    ];

    // The body arrives composed and edited from the UI — persist it verbatim.
    // Re-generating it here would silently discard the user's edits.
    const skillRow = await this.container.skillsRepo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'extracted',
      body: input.body,
      enabled: input.enabled,
      ...(evidenceFiles.length > 0 ? { evidenceFiles } : {}),
    });

    await this.repo.markAccepted(
      workspaceId,
      candidates.map((c) => c.id),
      skillRow.id,
    );

    let linkedAgentId: string | null = null;
    if (input.agent_id) {
      const existing = await this.container.agentsRepo.skillIdsForAgent(input.agent_id);
      // Append: extraction should not reshuffle an agent's carefully ordered
      // skill list, and linkSkill upserts so a re-link is a no-op.
      await this.container.agentsRepo.linkSkill(input.agent_id, skillRow.id, existing.length);
      linkedAgentId = input.agent_id;
    }

    return {
      skill: toSkillDto(skillRow),
      linked_agent_id: linkedAgentId,
      accepted: candidates.length,
    };
  }
}

// ---- sampling I/O ---------------------------------------------------------

/** Read one file out of the clone; missing/unreadable files are simply skipped. */
async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}

/** Sampled source files as path → lines (un-numbered; the gate compares these). */
async function readSampleFiles(
  clonePath: string,
  paths: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const path of paths) {
    const raw = await readClone(clonePath, path);
    if (raw === null) continue;
    out.set(path, raw.split('\n'));
  }
  return out;
}

/** Config files present at the clone root, truncated. */
async function readConfigFiles(clonePath: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const name of CONFIG_FILES) {
    const raw = await readClone(clonePath, name);
    if (raw === null) continue;
    out.push([name, raw.slice(0, MAX_CONFIG_CHARS)]);
  }
  return out;
}

/**
 * Render sampled files into one prompt block. Repo content is untrusted input —
 * a file in the target repo could contain instructions aimed at this model — so
 * every body goes inside an `<untrusted>` envelope.
 */
function renderSample(entries: [string, string][]): string {
  if (entries.length === 0) return '(none)';
  return entries
    .map(([path, body]) => `FILE: ${path}\n${wrapUntrusted(path, body)}`)
    .join('\n\n');
}
