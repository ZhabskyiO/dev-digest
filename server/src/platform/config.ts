import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at server/src/platform/config.ts; three levels up is the
// repo root (server/src/platform -> server/src -> server -> repo root), which
// is where the sibling `agent-runner/` package lives.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  // Intent Layer (L03) — derives a per-PR `Intent` (statement + in/out-of-scope)
  // once per head_sha and feeds it to the reviewer. Default ON.
  INTENT_ENABLED: z.string().optional(),
  // A/B lever for the confirmation-bias risk (see the Intent Layer plan, R-1):
  // when false, intent is still derived/persisted/served to the UI, but the
  // slot is withheld from reviewPullRequest so the prompt is unaffected.
  INTENT_IN_PROMPT: z.string().optional(),
  // Gates evidence tiers (d) external URLs and (e) Jira/Linear. Default OFF —
  // opt-in only, unlike the other two flags above.
  INTENT_EXTERNAL_EVIDENCE: z.string().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  // Loopback by default: the API is unauthenticated, so binding it to 0.0.0.0
  // would expose every route to the local network. Override only when the API
  // itself runs in a container and must accept traffic from outside it.
  API_HOST: z.string().min(1).default('127.0.0.1'),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
  // Project Context (attach specs/docs/insights to a review) — discovery roots
  // walked at any depth in the repo clone, comma-separated, case-insensitive.
  PROJECT_CONTEXT_ROOTS: z.string().default('specs,docs,insights'),
  // Conventional filenames recognised anywhere in the clone regardless of
  // which root (if any) they sit under, comma-separated, case-insensitive.
  // Exact basename matches only — NOT globs. The reader looks each candidate's
  // basename up in a Map, so a pattern like `*.md` matches only a file
  // literally named `*.md`; leave this empty to discover by root alone.
  PROJECT_CONTEXT_FILENAMES: z.string().default('insights.md'),
  // Per-run token budget for the effective (attached) document set. Documents
  // are injected in order until the budget is reached; the remainder is
  // dropped and recorded with an over-budget reason (AC-23).
  PROJECT_CONTEXT_BUDGET_TOKENS: z.coerce.number().int().positive().default(12000),
  // Per-document character cap applied before injection; the excess is
  // truncated and the truncation is recorded in the trace (AC-24).
  PROJECT_CONTEXT_DOC_CHAR_CAP: z.coerce.number().int().positive().default(16000),
  // Discovery cap on the number of documents returned per scan (AC-5).
  PROJECT_CONTEXT_MAX_DOCS: z.coerce.number().int().positive().default(500),
  // Discovery cap on a single file's size in bytes; larger files are omitted
  // and counted (AC-5).
  PROJECT_CONTEXT_MAX_FILE_BYTES: z.coerce.number().int().positive().default(1048576),
  // Character cap applied when rendering a document preview in the UI (not
  // the run-time injection cap above, which is PROJECT_CONTEXT_DOC_CHAR_CAP).
  PROJECT_CONTEXT_PREVIEW_CHARS: z.coerce.number().int().positive().default(16000),

  // Onboarding tour generation — the single structured model call that builds
  // a repo's onboarding tour (AC-5: at most one call plus one repair
  // re-prompt). All defaulted; no consumer may hardcode these numbers.
  // Token budget for the assembled generation prompt (repo skeleton +
  // excerpts + endpoint facts, etc.).
  ONBOARDING_PROMPT_TOKEN_BUDGET: z.coerce.number().int().positive().default(28000),
  // Per-file character cap applied to a key-file excerpt before injection.
  ONBOARDING_EXCERPT_CHAR_CAP: z.coerce.number().int().positive().default(4000),
  // Max number of key-file excerpts included in the generation prompt.
  ONBOARDING_MAX_EXCERPT_FILES: z.coerce.number().int().positive().default(10),
  // Max number of endpoint facts (from repo-intel) included in the prompt.
  ONBOARDING_MAX_ENDPOINT_FACTS: z.coerce.number().int().positive().default(200),
  // AC-10's threshold: a section with fewer grounded items than this after
  // dropping ungrounded ones is stored empty with an `insufficient_grounding`
  // reason instead of being backfilled.
  ONBOARDING_MIN_SECTION_ITEMS: z.coerce.number().int().positive().default(1),
  // Max number of critical-path entries in the generated tour.
  ONBOARDING_MAX_CRITICAL_PATHS: z.coerce.number().int().positive().default(8),
  // Max number of command attestations (from package.json scripts, etc.).
  ONBOARDING_MAX_COMMANDS: z.coerce.number().int().positive().default(12),
  // Max number of entries in the suggested reading path.
  ONBOARDING_MAX_READING_PATH: z.coerce.number().int().positive().default(7),
  // Max number of suggested first tasks.
  ONBOARDING_MAX_FIRST_TASKS: z.coerce.number().int().positive().default(5),
  // Max number of frontend routes listed in the tour.
  ONBOARDING_MAX_FRONTEND_ROUTES: z.coerce.number().int().positive().default(12),
  // Max number of API endpoints listed in the tour.
  ONBOARDING_MAX_API_ENDPOINTS: z.coerce.number().int().positive().default(24),
  // Timeout for ONE provider attempt inside the structured generation call
  // (adapters/llm/openai.ts's `req.timeoutMs`, applied per `withTimeout(...)`
  // around each `chat.completions.create`), NOT a total wall-clock budget for
  // the call. `maxRetries: 1` (service.ts) permits two sequential attempts,
  // so the call's worst-case wall time is ~2x this value. JobRunner's own job
  // timeout (platform/jobs.ts, 120s default) wraps the WHOLE handler — if
  // 2x this value exceeded that budget, a slow-but-still-running generation
  // would be aborted and retried by JobRunner while the original attempt
  // could still write a tour. Default is 45000 so the 2x worst case (90s)
  // stays comfortably under the 120s job timeout; never raise this above
  // half the job timeout.
  ONBOARDING_GENERATION_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  // Language the generated tour is written in.
  ONBOARDING_LANGUAGE: z.string().min(1).default('English'),
  // Absolute path to the agent-runner ncc bundle exported into a target repo's
  // `.devdigest/runner/index.js` (Export-to-CI). A path, not a secret — the
  // build artifact is git-ignored (`agent-runner/dist/`), so this is only
  // populated after `cd agent-runner && pnpm build`; see FsCiRunnerBundle.
  DEVDIGEST_RUNNER_BUNDLE: z.string().optional(),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  /** Interface the API binds to. Loopback by default — see API_HOST. */
  apiHost: string;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /** Master switch for the Intent Layer (L03). Default ON. */
  intentEnabled: boolean;
  /**
   * Whether a derived intent is passed into the review prompt. Default ON.
   * Set INTENT_IN_PROMPT=false to keep deriving/persisting/serving the card
   * while withholding the slot from `reviewPullRequest` — the A/B lever for
   * the confirmation-bias risk (see the Intent Layer plan, R-1).
   */
  intentInPromptEnabled: boolean;
  /** Gates evidence tiers (d)/(e) (external URLs, Jira/Linear). Default OFF. */
  intentExternalEvidenceEnabled: boolean;
  /**
   * Project Context discovery roots, walked at any depth in the repo clone.
   * Lower-cased and trimmed for case-insensitive matching against path
   * segments. Default `['specs', 'docs', 'insights']`.
   */
  projectContextRoots: string[];
  /**
   * Conventional filenames recognised anywhere in the clone regardless of
   * root. Lower-cased and trimmed for case-insensitive matching. Default
   * `['insights.md']`.
   */
  projectContextFilenames: string[];
  /**
   * Token budget for the effective (attached) project-context document set
   * on a run. Documents are injected in order until this is reached; the
   * remainder is dropped (AC-23). See PROJECT_CONTEXT_BUDGET_TOKENS default.
   */
  projectContextBudgetTokens: number;
  /**
   * Per-document character cap applied before injection into a run's prompt
   * (AC-24). See PROJECT_CONTEXT_DOC_CHAR_CAP default.
   */
  projectContextDocCharCap: number;
  /** Discovery cap on the number of documents returned per scan (AC-5). See PROJECT_CONTEXT_MAX_DOCS default. */
  projectContextMaxDocs: number;
  /**
   * Discovery cap on a single file's size in bytes; larger files are omitted
   * and counted (AC-5). See PROJECT_CONTEXT_MAX_FILE_BYTES default.
   */
  projectContextMaxFileBytes: number;
  /**
   * Character cap applied when rendering a document preview in the UI.
   * Independent of `projectContextDocCharCap`, which gates run-time
   * injection. See PROJECT_CONTEXT_PREVIEW_CHARS default.
   */
  projectContextPreviewChars: number;
  /** Token budget for the onboarding-tour generation prompt. See ONBOARDING_PROMPT_TOKEN_BUDGET default. */
  onboardingPromptTokenBudget: number;
  /** Per-file character cap applied to a key-file excerpt. See ONBOARDING_EXCERPT_CHAR_CAP default. */
  onboardingExcerptCharCap: number;
  /** Max number of key-file excerpts in the generation prompt. See ONBOARDING_MAX_EXCERPT_FILES default. */
  onboardingMaxExcerptFiles: number;
  /** Max number of endpoint facts included in the generation prompt. See ONBOARDING_MAX_ENDPOINT_FACTS default. */
  onboardingMaxEndpointFacts: number;
  /**
   * AC-10's minimum-items threshold: a section left with fewer grounded
   * items than this after dropping ungrounded ones is stored empty with an
   * `insufficient_grounding` reason rather than backfilled. See
   * ONBOARDING_MIN_SECTION_ITEMS default.
   */
  onboardingMinSectionItems: number;
  /** Max number of critical-path entries in the generated tour. See ONBOARDING_MAX_CRITICAL_PATHS default. */
  onboardingMaxCriticalPaths: number;
  /** Max number of command attestations in the generated tour. See ONBOARDING_MAX_COMMANDS default. */
  onboardingMaxCommands: number;
  /** Max number of entries in the suggested reading path. See ONBOARDING_MAX_READING_PATH default. */
  onboardingMaxReadingPath: number;
  /** Max number of suggested first tasks. See ONBOARDING_MAX_FIRST_TASKS default. */
  onboardingMaxFirstTasks: number;
  /** Max number of frontend routes listed in the tour. See ONBOARDING_MAX_FRONTEND_ROUTES default. */
  onboardingMaxFrontendRoutes: number;
  /** Max number of API endpoints listed in the tour. See ONBOARDING_MAX_API_ENDPOINTS default. */
  onboardingMaxApiEndpoints: number;
  /**
   * Timeout for ONE provider attempt of the onboarding-tour structured
   * generation call — NOT a total wall-clock budget (up to 2 attempts run
   * sequentially). See ONBOARDING_GENERATION_TIMEOUT_MS default and its doc
   * comment above.
   */
  onboardingGenerationTimeoutMs: number;
  /** Language the generated onboarding tour is written in. See ONBOARDING_LANGUAGE default. */
  onboardingLanguage: string;
  /**
   * Absolute path to the agent-runner ncc bundle read by `FsCiRunnerBundle`
   * (Export-to-CI). Default `<repo-root>/agent-runner/dist/index.js` — that
   * file only exists after `cd agent-runner && pnpm build`, since
   * `agent-runner/dist/` is git-ignored. Override via DEVDIGEST_RUNNER_BUNDLE.
   */
  runnerBundlePath: string;
};

/**
 * Splits a comma-separated env value into trimmed, lower-cased, non-empty
 * entries — shared by PROJECT_CONTEXT_ROOTS and PROJECT_CONTEXT_FILENAMES so
 * matching against clone paths can stay case-insensitive.
 */
function parseCsvList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  const runnerBundleRaw =
    parsed.DEVDIGEST_RUNNER_BUNDLE ?? join(REPO_ROOT, 'agent-runner', 'dist', 'index.js');
  const runnerBundlePath = isAbsolute(runnerBundleRaw)
    ? runnerBundleRaw
    : resolve(process.cwd(), runnerBundleRaw);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    apiHost: parsed.API_HOST,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    intentEnabled: parsed.INTENT_ENABLED !== 'false',
    intentInPromptEnabled: parsed.INTENT_IN_PROMPT !== 'false',
    intentExternalEvidenceEnabled: parsed.INTENT_EXTERNAL_EVIDENCE === 'true',
    projectContextRoots: parseCsvList(parsed.PROJECT_CONTEXT_ROOTS),
    projectContextFilenames: parseCsvList(parsed.PROJECT_CONTEXT_FILENAMES),
    projectContextBudgetTokens: parsed.PROJECT_CONTEXT_BUDGET_TOKENS,
    projectContextDocCharCap: parsed.PROJECT_CONTEXT_DOC_CHAR_CAP,
    projectContextMaxDocs: parsed.PROJECT_CONTEXT_MAX_DOCS,
    projectContextMaxFileBytes: parsed.PROJECT_CONTEXT_MAX_FILE_BYTES,
    projectContextPreviewChars: parsed.PROJECT_CONTEXT_PREVIEW_CHARS,
    onboardingPromptTokenBudget: parsed.ONBOARDING_PROMPT_TOKEN_BUDGET,
    onboardingExcerptCharCap: parsed.ONBOARDING_EXCERPT_CHAR_CAP,
    onboardingMaxExcerptFiles: parsed.ONBOARDING_MAX_EXCERPT_FILES,
    onboardingMaxEndpointFacts: parsed.ONBOARDING_MAX_ENDPOINT_FACTS,
    onboardingMinSectionItems: parsed.ONBOARDING_MIN_SECTION_ITEMS,
    onboardingMaxCriticalPaths: parsed.ONBOARDING_MAX_CRITICAL_PATHS,
    onboardingMaxCommands: parsed.ONBOARDING_MAX_COMMANDS,
    onboardingMaxReadingPath: parsed.ONBOARDING_MAX_READING_PATH,
    onboardingMaxFirstTasks: parsed.ONBOARDING_MAX_FIRST_TASKS,
    onboardingMaxFrontendRoutes: parsed.ONBOARDING_MAX_FRONTEND_ROUTES,
    onboardingMaxApiEndpoints: parsed.ONBOARDING_MAX_API_ENDPOINTS,
    onboardingGenerationTimeoutMs: parsed.ONBOARDING_GENERATION_TIMEOUT_MS,
    onboardingLanguage: parsed.ONBOARDING_LANGUAGE,
    runnerBundlePath,
  };
}
