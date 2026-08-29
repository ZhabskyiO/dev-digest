import type { Agent, Skill, CiFile, CiPostAs, CiTrigger } from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';
import { AGENTS_DIR, MAX_RUNNER_BYTES, RUNNER_PATH, SKILLS_DIR, WORKFLOW_PATH } from './constants.js';
import { renderManifest } from './manifest.js';
import { toSlug, toUniqueSlugs } from './slug.js';
import { renderWorkflow, validateWorkflowYaml } from './workflow.js';

export interface BuildBundleInput {
  agent: Agent;
  /** Attached skills, in the agent's persisted skill order — dedup slugging
   * (AC-17) and the manifest's `skills` list both depend on this order. */
  skills: readonly Skill[];
  /** Contents of the bundled `agent-runner` CLI (`agent-runner/dist/index.js`),
   * embedded verbatim at `.devdigest/runner/index.js`. */
  runnerSource: string;
  /** The same trigger/post-destination answers Preview and Export share. */
  input: { triggers: readonly CiTrigger[]; post_as: CiPostAs };
  /**
   * This-export-only workflow YAML edit (AC-56, AC-57) — validated here and
   * used verbatim for this call only. `undefined`/`null` generates the
   * workflow from `agent`/`input` instead; never persisted, so a later
   * export/update regenerates fresh (AC-49).
   */
  workflowOverride?: string | null;
}

/**
 * Build the deterministic, side-effect-free file bundle for Step 2 preview and
 * the install/update paths (AC-13, AC-14, AC-14b, AC-15, AC-18, AC-19).
 *
 * Deliberately contains NO memory file — `.devdigest/memory.jsonl` is a
 * declared non-goal (D2) and is never referenced here.
 */
export function buildBundle({
  agent,
  skills,
  runnerSource,
  input,
  workflowOverride,
}: BuildBundleInput): CiFile[] {
  const runnerBytes = Buffer.byteLength(runnerSource, 'utf8');
  if (runnerBytes > MAX_RUNNER_BYTES) {
    throw new ConfigError(
      `Runner bundle is ${runnerBytes} bytes, exceeding the ${MAX_RUNNER_BYTES}-byte limit`,
    );
  }

  const agentSlug = toSlug(agent.name);
  const skillSlugs = toUniqueSlugs(skills.map((skill) => skill.name));

  const manifestContents = renderManifest(agent, skillSlugs);

  let workflowContents: string;
  if (workflowOverride != null) {
    validateWorkflowYaml(workflowOverride);
    workflowContents = workflowOverride;
  } else {
    workflowContents = renderWorkflow({ triggers: input.triggers, postAs: input.post_as });
  }

  const files: CiFile[] = [
    { path: `${AGENTS_DIR}/${agentSlug}.yaml`, contents: manifestContents, editable: false },
    ...skills.map((skill, i) => ({
      path: `${SKILLS_DIR}/${skillSlugs[i]}.md`,
      contents: skill.body,
      editable: false,
    })),
    { path: RUNNER_PATH, contents: runnerSource, editable: false },
    { path: WORKFLOW_PATH, contents: workflowContents, editable: true },
  ];

  return files;
}
