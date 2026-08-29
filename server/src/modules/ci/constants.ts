/**
 * Fixed, non-configurable values shared by the CI generation modules
 * (`manifest.ts`, `workflow.ts`, `bundle.ts`, and `repository.ts` — T9). Kept
 * here so a single edit updates every generator consistently, and so tests can
 * assert against the same source of truth the generators use.
 *
 * Action refs are pinned to an explicit tag (never a floating major like `@v4`)
 * per AC-37 — a floating ref would let a third-party action update silently
 * change what runs inside every already-exported PR's workflow.
 */

/** Where the agent manifest and skill bundle read from at generation time (studio) and at
 * CI runtime (agent-runner) both expect this exact `.devdigest/**` layout. */
export const AGENTS_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
/** Path to the bundled agent-runner CLI inside the exported repo. */
export const RUNNER_PATH = '.devdigest/runner/index.js';
/** Path to the generated GitHub Actions workflow — the only editable bundle file (AC-18). */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/** Name GitHub Actions' artifact UI shows for the uploaded result (AC-36). */
export const ARTIFACT_NAME = 'devdigest-result';
/** File the runner writes and the workflow uploads — must match `DEVDIGEST_RESULT_PATH`
 * default in `agent-runner/src/index.ts` (`devdigest-result.json` in the job's cwd). */
export const ARTIFACT_FILE = 'devdigest-result.json';

/** Dedicated branch every export/update commits onto (AC-26, AC-27). */
export const EXPORT_BRANCH = 'devdigest/ci';

/** Node major version the generated workflow pins `actions/setup-node` to. Pinned to 22,
 * not inherited from a screenshot's Node 20 (spec Q12): agent-runner is built and tested
 * against Node 22 (`.nvmrc` = 22 repo-wide), so running CI on anything else is unverified. */
export const NODE_MAJOR = '22';

/** Name of the Actions secret the workflow reads the LLM credential from (AC-24, AC-52) —
 * referenced by name only, never by value. */
export const LLM_SECRET_NAME = 'OPENROUTER_API_KEY';

/** Pinned third-party action refs (AC-37) — explicit tag, never a floating major. */
export const CHECKOUT_ACTION = 'actions/checkout@v4.2.2';
export const SETUP_NODE_ACTION = 'actions/setup-node@v4.1.0';
export const UPLOAD_ARTIFACT_ACTION = 'actions/upload-artifact@v4.4.3';

/** Exported runner bundle size ceiling (Non-functional: "≤ 5 MB"). Enforced in `bundle.ts`. */
export const MAX_RUNNER_BYTES = 5 * 1024 * 1024;
