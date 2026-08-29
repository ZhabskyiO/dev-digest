import { parse, stringify, YAMLParseError } from 'yaml';
import type { CiPostAs, CiTrigger } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import {
  ARTIFACT_FILE,
  ARTIFACT_NAME,
  CHECKOUT_ACTION,
  LLM_SECRET_NAME,
  NODE_MAJOR,
  RUNNER_PATH,
  SETUP_NODE_ACTION,
  UPLOAD_ARTIFACT_ACTION,
} from './constants.js';

/**
 * Canonical order for `on.pull_request.types` — normalised regardless of the
 * order the wizard/caller supplied `triggers` in, so two exports with the same
 * SET of triggers (e.g. supplied via `Set` iteration client-side, which is not
 * guaranteed stable across callers) always produce byte-identical YAML (AC-19).
 */
const TRIGGER_ORDER: readonly CiTrigger[] = ['opened', 'synchronize', 'reopened'];

export interface RenderWorkflowInput {
  triggers: readonly CiTrigger[];
  postAs: CiPostAs;
}

/**
 * Render the GitHub Actions workflow that installs DevDigest review as a
 * `pull_request` check (AC-33…AC-37, AC-22, AC-52).
 *
 * Deliberately built as a plain JS object → `yaml.stringify`, never string
 * concatenation — this guarantees valid YAML by construction and lets
 * `validateWorkflowYaml` exercise the exact same parser a hostile
 * `workflow_override` edit is checked against.
 */
export function renderWorkflow({ triggers, postAs }: RenderWorkflowInput): string {
  const types = TRIGGER_ORDER.filter((t) => triggers.includes(t));
  // Minimum token permissions for the chosen destination (AC-22, Non-functional
  // "Security"): a workflow that never posts back needs no write access.
  const pullRequestsPermission = postAs === 'none' ? 'read' : 'write';

  const doc = {
    name: 'DevDigest Review',
    // `pull_request` only — NEVER `pull_request_target`, which would hand a
    // fork PR access to this repo's secrets (AC-33).
    on: {
      pull_request: {
        types,
      },
    },
    permissions: {
      contents: 'read',
      'pull-requests': pullRequestsPermission,
    },
    jobs: {
      // Explain, don't fail (AC-34): a fork PR has no access to this repo's
      // secrets, so attempting the review job would fail with a confusing
      // missing-secret error instead of a clear, non-red skip.
      'fork-notice': {
        if: 'github.event.pull_request.head.repo.full_name != github.repository',
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            name: 'Skip — fork pull request',
            run: 'echo "DevDigest review skipped: pull requests from forks cannot access repository secrets. Merge from a branch on this repository to run the review."',
          },
        ],
      },
      review: {
        if: 'github.event.pull_request.head.repo.full_name == github.repository',
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            uses: CHECKOUT_ACTION,
            with: {
              // BASE ref, never head (AC-35, security-critical): `.devdigest/**`
              // (manifest, skills, ci_fail_on, system_prompt) is read from this
              // checkout, so a PR editing those files must not be able to weaken
              // the gate judging it. Only the diff fetched from the GitHub API
              // reflects the PR head.
              ref: '${{ github.event.pull_request.base.sha }}',
            },
          },
          {
            uses: SETUP_NODE_ACTION,
            with: {
              // Pinned to the version agent-runner is built and tested against
              // (repo-wide `.nvmrc` = 22), not inherited from an older screenshot.
              'node-version': NODE_MAJOR,
            },
          },
          {
            // Explain, don't fail (same philosophy as `fork-notice`): on the
            // very PR that installs DevDigest, the BASE branch (checked out
            // above, AC-35) doesn't have `.devdigest/` yet — it only lands
            // once this PR merges — so `node .devdigest/runner/index.js`
            // would otherwise exit MODULE_NOT_FOUND and paint a confusing red
            // X on the install PR itself. Gating the runner step on this
            // check turns that into a clear, non-failing explanation instead.
            name: 'Check DevDigest is on the base branch',
            id: 'bootstrap',
            run: [
              'if [ -f .devdigest/runner/index.js ]; then',
              '  echo "present=true" >> "$GITHUB_OUTPUT"',
              'else',
              '  echo "present=false" >> "$GITHUB_OUTPUT"',
              '  echo "DevDigest review skipped: .devdigest/ is not on the base branch yet. It activates once the install PR merges."',
              'fi',
            ].join('\n'),
          },
          {
            name: 'Run DevDigest review',
            if: "steps.bootstrap.outputs.present == 'true'",
            env: {
              // Secret NAMES only (AC-52) — never a literal value.
              OPENROUTER_API_KEY: `\${{ secrets.${LLM_SECRET_NAME} }}`,
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              GITHUB_REPOSITORY: '${{ github.repository }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
              // Carries the wizard's Step-3 choice to the runner at execution
              // time (AC-22) — closes the gap where post_as was captured but
              // never reached the runner.
              DEVDIGEST_POST_AS: postAs,
            },
            run: `node ${RUNNER_PATH}`,
          },
          {
            if: 'always()',
            uses: UPLOAD_ARTIFACT_ACTION,
            with: {
              name: ARTIFACT_NAME,
              path: ARTIFACT_FILE,
              'if-no-files-found': 'ignore',
            },
          },
        ],
      },
    },
  };

  return stringify(doc);
}

/**
 * Validate a (possibly user-edited) workflow YAML string (AC-57). Throws a
 * `ValidationError` (this repo's 422 "bad input" error — see
 * `platform/errors.ts`) carrying the parser's own message, which already
 * embeds the line/column of the problem, when the text is not valid YAML.
 * Never commits anything on a parse failure — this is called BEFORE the
 * install path touches GitHub.
 */
export function validateWorkflowYaml(contents: string): void {
  try {
    parse(contents);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new ValidationError(`Invalid workflow YAML: ${err.message}`, {
        pos: err.pos,
        linePos: err.linePos,
      });
    }
    throw new ValidationError(
      `Invalid workflow YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
