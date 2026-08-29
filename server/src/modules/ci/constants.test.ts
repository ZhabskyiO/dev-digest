import { describe, expect, it } from 'vitest';
import {
  AGENTS_DIR,
  ARTIFACT_FILE,
  ARTIFACT_NAME,
  CHECKOUT_ACTION,
  EXPORT_BRANCH,
  LLM_SECRET_NAME,
  MAX_RUNNER_BYTES,
  NODE_MAJOR,
  RUNNER_PATH,
  SETUP_NODE_ACTION,
  SKILLS_DIR,
  UPLOAD_ARTIFACT_ACTION,
  WORKFLOW_PATH,
} from './constants.js';

describe('ci constants', () => {
  it('pins exact paths and values the runner/workflow generators rely on', () => {
    expect(WORKFLOW_PATH).toBe('.github/workflows/devdigest-review.yml');
    expect(RUNNER_PATH).toBe('.devdigest/runner/index.js');
    expect(AGENTS_DIR).toBe('.devdigest/agents');
    expect(SKILLS_DIR).toBe('.devdigest/skills');
    expect(ARTIFACT_NAME).toBe('devdigest-result');
    expect(ARTIFACT_FILE).toBe('devdigest-result.json');
    expect(EXPORT_BRANCH).toBe('devdigest/ci');
    expect(NODE_MAJOR).toBe('22');
    expect(LLM_SECRET_NAME).toBe('OPENROUTER_API_KEY');
    expect(MAX_RUNNER_BYTES).toBe(5 * 1024 * 1024);
  });

  it('pins every third-party action to an explicit version tag (AC-37)', () => {
    for (const ref of [CHECKOUT_ACTION, SETUP_NODE_ACTION, UPLOAD_ARTIFACT_ACTION]) {
      expect(ref).toMatch(/^[\w-]+\/[\w-]+@v\d+\.\d+\.\d+$/);
    }
    expect(CHECKOUT_ACTION).toBe('actions/checkout@v4.2.2');
    expect(SETUP_NODE_ACTION).toBe('actions/setup-node@v4.1.0');
    expect(UPLOAD_ARTIFACT_ACTION).toBe('actions/upload-artifact@v4.4.3');
  });
});
