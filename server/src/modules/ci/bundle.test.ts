import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { AgentManifest, type Agent, type Skill } from '@devdigest/shared';
import { buildBundle } from './bundle.js';
import { MAX_RUNNER_BYTES, WORKFLOW_PATH } from './constants.js';

const AGENT: Agent = {
  id: 'agent-1',
  name: 'Security Reviewer',
  description: 'Flags secrets and injection risks',
  provider: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet',
  system_prompt: 'You are a careful security reviewer.',
  output_schema: null,
  enabled: true,
  version: 3,
  strategy: 'single-pass',
  ci_fail_on: 'warning',
  repo_intel: true,
};

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    id: overrides.id ?? 'skill-1',
    name: overrides.name ?? 'Security',
    description: '',
    type: 'security',
    source: 'manual',
    body: overrides.body ?? '# Security\nCheck for secrets.',
    enabled: true,
    version: 1,
    evidence_files: null,
    ...overrides,
  };
}

const RUNNER_SOURCE = '// bundled runner\nconsole.log("hi");\n';

const BASE_INPUT = { triggers: ['opened', 'synchronize'] as const, post_as: 'github_review' as const };

describe('buildBundle', () => {
  it('produces exactly five files for a two-skill agent, with no memory.jsonl (AC-14, AC-14b)', () => {
    const skills = [makeSkill({ id: 's1', name: 'Security' }), makeSkill({ id: 's2', name: 'Style Guide' })];
    const files = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });

    expect(files).toHaveLength(5);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/security.md',
      '.devdigest/skills/style-guide.md',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);
    expect(paths.some((p) => p.endsWith('memory.jsonl'))).toBe(false);
  });

  it('emits an agent with zero skills too, unaffected by memory rows (AC-14b)', () => {
    const files = buildBundle({ agent: AGENT, skills: [], runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);
  });

  it('contains exactly one file under .devdigest/agents/ (AC-15)', () => {
    const skills = [makeSkill({ id: 's1', name: 'A' }), makeSkill({ id: 's2', name: 'B' })];
    const files = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    const manifests = files.filter((f) => f.path.startsWith('.devdigest/agents/'));
    expect(manifests).toHaveLength(1);
  });

  it('every manifest slug matches the runner shape and has a bundled file, hostile name normalises (AC-17)', () => {
    const skills = [
      makeSkill({ id: 's1', name: 'My Skill' }),
      makeSkill({ id: 's2', name: '../../etc/passwd' }),
    ];
    const files = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    const manifestFile = files.find((f) => f.path.startsWith('.devdigest/agents/'))!;
    const manifest = AgentManifest.parse(parse(manifestFile.contents));
    for (const slug of manifest.skills) {
      expect(slug).toMatch(/^[a-zA-Z0-9_-]+$/);
      const bundled = files.find((f) => f.path === `.devdigest/skills/${slug}.md`);
      expect(bundled).toBeDefined();
    }
  });

  it('marks editable true only for the workflow file (AC-18)', () => {
    const skills = [makeSkill({ id: 's1', name: 'Security' })];
    const files = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    for (const file of files) {
      expect(file.editable).toBe(file.path === WORKFLOW_PATH);
    }
  });

  it('produces byte-identical SHA-256 over joined contents for identical inputs (AC-19)', () => {
    const skills = [makeSkill({ id: 's1', name: 'Security' }), makeSkill({ id: 's2', name: 'Style Guide' })];
    const hash = (files: ReturnType<typeof buildBundle>) =>
      createHash('sha256').update(files.map((f) => `${f.path}\0${f.contents}`).join('\0')).digest('hex');

    const first = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    const second = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    expect(hash(first)).toBe(hash(second));
  });

  it('applies a validated workflow_override for this export only, without regenerating it', () => {
    const override = 'name: Custom\non:\n  pull_request:\n    types: [opened]\n';
    const files = buildBundle({
      agent: AGENT,
      skills: [],
      runnerSource: RUNNER_SOURCE,
      input: BASE_INPUT,
      workflowOverride: override,
    });
    const workflowFile = files.find((f) => f.path === WORKFLOW_PATH)!;
    expect(workflowFile.contents).toBe(override);
  });

  it('rejects an invalid workflow_override before producing a bundle (AC-57)', () => {
    expect(() =>
      buildBundle({
        agent: AGENT,
        skills: [],
        runnerSource: RUNNER_SOURCE,
        input: BASE_INPUT,
        workflowOverride: 'a:\n - b\n  c:',
      }),
    ).toThrow();
  });

  it('rejects a runner bundle larger than MAX_RUNNER_BYTES', () => {
    const oversized = 'x'.repeat(MAX_RUNNER_BYTES + 1);
    expect(() =>
      buildBundle({ agent: AGENT, skills: [], runnerSource: oversized, input: BASE_INPUT }),
    ).toThrow();
  });

  it('never emits a value matching a GitHub token or OpenAI-style key shape, nor any secret value (AC-52)', () => {
    const skills = [makeSkill({ id: 's1', name: 'Security' })];
    const files = buildBundle({ agent: AGENT, skills, runnerSource: RUNNER_SOURCE, input: BASE_INPUT });
    const secretLike = /gh[ps]_[A-Za-z0-9]{36,}|sk-[A-Za-z0-9]/;
    for (const file of files) {
      expect(file.contents).not.toMatch(secretLike);
    }
  });
});
