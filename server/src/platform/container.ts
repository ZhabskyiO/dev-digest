import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  TicketProvider,
  CiRunnerBundle,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { JiraTicketProvider } from '../adapters/tickets/jira.js';
import { LinearTicketProvider } from '../adapters/tickets/linear.js';
import { ProjectContextService } from '../modules/project-context/service.js';
import { ProjectContextRepository } from '../modules/project-context/repository.js';
import { OnboardingService } from '../modules/onboarding/service.js';
import { BlastService } from '../modules/blast/service.js';
import { FsCiRunnerBundle } from '../adapters/ci-runner/fs.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /** Intent Layer tier (e), gated by INTENT_EXTERNAL_EVIDENCE — tests inject a MockTicketProvider. */
  tickets?: TicketProvider;
  /** T11 (project-context routes) — tests inject a fake ProjectContextService so
   *  route-smoke tests stay hermetic (no DB, no clone on disk). */
  projectContext?: ProjectContextService;
  /**
   * The following three shared repositories (`agentsRepo`, `skillsRepo`,
   * `reviewRepo`) previously had no override slot — every consumer got the
   * real, DB-backed instance unconditionally. T11 adds these three so its
   * route-smoke tests can assert cross-workspace rejection (agent/skill/repo
   * ownership checks) without a real Postgres. Existing callers are
   * unaffected: omitting the override keeps today's real-DB construction.
   */
  agentsRepo?: AgentsRepository;
  skillsRepo?: SkillsRepository;
  reviewRepo?: ReviewRepository;
  /** `modules/reviews/prompt-context.ts::resolveProjectContext` reads
   *  `projectContextRepo.getAttachment` directly (AC-44's attach-time-hash
   *  comparison) — tests of that builder inject a fake here instead of a
   *  real Postgres. */
  projectContextRepo?: ProjectContextRepository;
  /** T12 (onboarding routes) — tests inject a fake `OnboardingService` so
   *  route-smoke tests stay hermetic (no DB, no clone on disk, no model
   *  call), mirroring `ContainerOverrides.projectContext`. */
  onboarding?: OnboardingService;
  /** T12 (PR Brief `BriefService`) — `getBrief` calls `container.blast`
   *  exactly once per read (blast + status + reason come back together on
   *  `BlastRadiusResult`); tests inject a fake `BlastService` here so a brief
   *  read-path test stays hermetic (no repo-intel index, no DB read for the
   *  blast map), mirroring `ContainerOverrides.onboarding`. */
  blast?: BlastService;
  /** Export-to-CI (T8) — the agent-runner ncc bundle read from disk. Tests
   *  inject `MockCiRunnerBundle` here instead of a real file. */
  ciRunnerBundle?: CiRunnerBundle;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _skillsRepo?: SkillsRepository;
  private _reviewRepo?: ReviewRepository;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;
  private _tickets?: TicketProvider;
  private _projectContext?: ProjectContextService;
  private _projectContextRepo?: ProjectContextRepository;
  private _onboarding?: OnboardingService;
  private _blast?: BlastService;
  private _ciRunnerBundle?: CiRunnerBundle;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    if (this.overrides.agentsRepo) return this.overrides.agentsRepo;
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    if (this.overrides.skillsRepo) return this.overrides.skillsRepo;
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    if (this.overrides.reviewRepo) return this.overrides.reviewRepo;
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  /**
   * Project-context application service (T11 wiring for T9's
   * `ProjectContextService`). Tests inject a fake via
   * `ContainerOverrides.projectContext`.
   */
  get projectContext(): ProjectContextService {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    return (this._projectContext ??= new ProjectContextService(this));
  }

  /**
   * Direct repository access for project-context reads that have no
   * corresponding `ProjectContextService` method — `GET /skills/:id/context`
   * used to reach this directly from routes.ts, but that has since moved to
   * `ProjectContextService.skillContext(skillId)` (the onion-layering fix
   * for that route). The remaining, legitimate caller is
   * `modules/reviews/prompt-context.ts::resolveProjectContext`, which reads
   * `getAttachment` for AC-44's attach-time-hash comparison — a case where
   * going through `container.projectContext` (the service) would be a
   * cross-module reach into a sibling's write-oriented API for a single
   * read, so this shared-repository getter (mirroring `agentsRepo`/
   * `skillsRepo`/`reviewRepo` above) stays.
   */
  get projectContextRepo(): ProjectContextRepository {
    if (this.overrides.projectContextRepo) return this.overrides.projectContextRepo;
    return (this._projectContextRepo ??= new ProjectContextRepository(this.db));
  }

  /**
   * Onboarding-tour application service (T12 wiring for T10's
   * `OnboardingService`). Tests inject a fake via
   * `ContainerOverrides.onboarding`.
   */
  get onboarding(): OnboardingService {
    if (this.overrides.onboarding) return this.overrides.onboarding;
    return (this._onboarding ??= new OnboardingService(this));
  }

  /**
   * PR-impact map — reads only, no model call anywhere in its path (see
   * `BlastService`'s own doc comment). LAZY, like every other adapter/service
   * getter here: constructing it eagerly in the constructor would run at app
   * build time and break any test that builds a `Container` from a *partial*
   * `ContainerOverrides` object without a real DB (server/insights/gotchas.md,
   * 2026-08-20). Tests inject a fake via `ContainerOverrides.blast`.
   */
  get blast(): BlastService {
    if (this.overrides.blast) return this.overrides.blast;
    return (this._blast ??= new BlastService(this));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * The agent-runner ncc bundle exported into a target repo's
   * `.devdigest/runner/index.js` (Export-to-CI). Reads and caches the file at
   * `config.runnerBundlePath` on first use — see `FsCiRunnerBundle`. Tests
   * inject `MockCiRunnerBundle` via `ContainerOverrides.ciRunnerBundle`.
   */
  get ciRunnerBundle(): CiRunnerBundle {
    if (this.overrides.ciRunnerBundle) return this.overrides.ciRunnerBundle;
    this._ciRunnerBundle ??= new FsCiRunnerBundle(this.config.runnerBundlePath);
    return this._ciRunnerBundle;
  }

  /**
   * Jira/Linear ticket lookup — Intent Layer tier (e). Lazy, like every other
   * adapter getter: nothing here is constructed until this getter is first
   * read. The caller (`IntentService.deriveForRun`) only reads it inside its
   * `INTENT_EXTERNAL_EVIDENCE` gate, so with that flag off (the default)
   * neither `JiraTicketProvider` nor `LinearTicketProvider` is ever
   * constructed and no network call is reachable.
   *
   * Tries Jira first, then Linear; each adapter degrades to `undefined` on
   * its own when its credential is unconfigured, so this composite needs no
   * config check of its own.
   */
  get tickets(): TicketProvider {
    if (this.overrides.tickets) return this.overrides.tickets;
    this._tickets ??= this.buildTicketProvider();
    return this._tickets;
  }

  private buildTicketProvider(): TicketProvider {
    const jira = new JiraTicketProvider(this.secrets);
    const linear = new LinearTicketProvider(this.secrets);
    return {
      fetchTicket: async (key: string) => (await jira.fetchTicket(key)) ?? linear.fetchTicket(key),
    };
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    // Every provider gets the PriceBook (live OpenRouter prices, static table as
    // fallback) so cost attribution is consistent across them.
    const estimateCostVia = (model: string, tokensIn: number, tokensOut: number) =>
      this.priceBook.estimate(model, tokensIn, tokensOut);

    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key, { estimateCost: estimateCostVia });
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, { estimateCost: estimateCostVia });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key, { estimateCost: estimateCostVia });
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
