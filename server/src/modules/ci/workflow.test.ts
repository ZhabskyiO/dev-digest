import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ValidationError } from '../../platform/errors.js';
import { ARTIFACT_FILE, ARTIFACT_NAME, NODE_MAJOR } from './constants.js';
import { renderWorkflow, validateWorkflowYaml } from './workflow.js';

const SECRET_LOOKALIKE = /gh[ps]_[A-Za-z0-9]{36,}|sk-[A-Za-z0-9]/;

describe('renderWorkflow', () => {
  it('triggers only on the selected pull_request types and never pull_request_target (AC-33)', () => {
    const yamlText = renderWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
    const doc = parse(yamlText);
    expect(doc.on.pull_request.types).toEqual(['opened', 'synchronize']);
    expect(doc.on.pull_request_target).toBeUndefined();
    expect(yamlText).not.toContain('pull_request_target');
  });

  it('normalises trigger order regardless of input order (determinism)', () => {
    const a = renderWorkflow({ triggers: ['synchronize', 'opened', 'reopened'], postAs: 'none' });
    const b = renderWorkflow({ triggers: ['opened', 'reopened', 'synchronize'], postAs: 'none' });
    expect(a).toBe(b);
  });

  it('has a fork-notice job and a same-repo-guarded review job (AC-34)', () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'github_review' }));
    expect(doc.jobs['fork-notice'].if).toContain(
      'github.event.pull_request.head.repo.full_name != github.repository',
    );
    expect(doc.jobs['fork-notice'].steps[0].run).toMatch(/skipped/i);
    expect(doc.jobs.review.if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it('checks out the pull request BASE sha, never the head (AC-35)', () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'github_review' }));
    const checkoutStep = doc.jobs.review.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/checkout@'),
    );
    expect(checkoutStep.with.ref).toBe('${{ github.event.pull_request.base.sha }}');
  });

  it('guards the runner step with a bootstrap check for .devdigest/ on the base branch (install-PR fix)', () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'github_review' }));
    const steps = doc.jobs.review.steps as Array<{
      id?: string;
      name?: string;
      run?: string;
      if?: string;
    }>;
    const bootstrapStep = steps.find((s) => s.id === 'bootstrap');
    expect(bootstrapStep).toBeDefined();
    expect(bootstrapStep!.run).toContain('.devdigest/runner/index.js');
    expect(bootstrapStep!.run).toContain('present=true');
    expect(bootstrapStep!.run).toContain('present=false');
    expect(bootstrapStep!.run).toMatch(/skipped/i);

    const runnerStep = steps.find((s) => s.name === 'Run DevDigest review');
    expect(runnerStep!.if).toBe("steps.bootstrap.outputs.present == 'true'");

    // The bootstrap step must run BEFORE the gated runner step.
    expect(steps.indexOf(bootstrapStep!)).toBeLessThan(steps.indexOf(runnerStep!));
  });

  it('uploads the runner result artifact under a stable name (AC-36)', () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'github_review' }));
    const uploadStep = doc.jobs.review.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/upload-artifact@'),
    );
    expect(uploadStep.with.name).toBe(ARTIFACT_NAME);
    expect(uploadStep.with.path).toBe(ARTIFACT_FILE);
    expect(uploadStep.if).toBe('always()');
  });

  it('pins every `uses:` to an explicit version tag and Node to 22 (AC-37)', () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'github_review' }));
    for (const step of doc.jobs.review.steps) {
      if (step.uses) {
        expect(step.uses).toMatch(/@v\d+\.\d+\.\d+$/);
      }
    }
    const setupNodeStep = doc.jobs.review.steps.find((s: { uses?: string }) =>
      s.uses?.startsWith('actions/setup-node@'),
    );
    expect(setupNodeStep.with['node-version']).toBe(NODE_MAJOR);
    expect(NODE_MAJOR).toBe('22');
  });

  it("conveys the chosen post destination to the runner as DEVDIGEST_POST_AS (AC-22)", () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'pr_comment' }));
    const runStep = doc.jobs.review.steps.find(
      (s: { env?: Record<string, string> }) => s.env?.DEVDIGEST_POST_AS,
    );
    expect(runStep.env.DEVDIGEST_POST_AS).toBe('pr_comment');
  });

  it('requests read-only pull-requests permission when post_as is none (least privilege)', () => {
    const doc = parse(renderWorkflow({ triggers: ['opened'], postAs: 'none' }));
    expect(doc.permissions['pull-requests']).toBe('read');
    const write = parse(renderWorkflow({ triggers: ['opened'], postAs: 'github_review' }));
    expect(write.permissions['pull-requests']).toBe('write');
  });

  it('never contains a secret value — only name-only secrets. references (AC-52)', () => {
    const yamlText = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yamlText).not.toMatch(SECRET_LOOKALIKE);
    expect(yamlText).toMatch(/secrets\.OPENROUTER_API_KEY/);
    expect(yamlText).toMatch(/secrets\.GITHUB_TOKEN/);
  });

  it('produces byte-identical output for identical inputs (AC-19)', () => {
    const a = renderWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
    const b = renderWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
    expect(a).toBe(b);
  });
});

describe('validateWorkflowYaml', () => {
  it('throws on invalid YAML with the parse position (AC-57)', () => {
    expect(() => validateWorkflowYaml('a:\n - b\n  c:')).toThrow(ValidationError);
  });

  it('does not throw on valid YAML', () => {
    expect(() => validateWorkflowYaml(renderWorkflow({ triggers: ['opened'], postAs: 'none' }))).not.toThrow();
  });
});
