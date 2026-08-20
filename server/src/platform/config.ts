import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

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
  };
}
