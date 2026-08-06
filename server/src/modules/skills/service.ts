import { lookup } from 'node:dns/promises';
import type { Container } from '../../platform/container.js';
import type {
  Agent,
  CommunitySkill,
  Skill,
  SkillImportPreview,
  SkillImportRequest,
  SkillSource,
  SkillStats,
  SkillStatsSummary,
  SkillType,
  SkillUsage,
  SkillVersion,
} from '@devdigest/shared';
import { SkillType as SkillTypeSchema } from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import {
  clampStatsDays,
  deriveSkillName,
  extractSkillFromArchive,
  isDisallowedIp,
  looksLikeHtml,
  normalizeImportUrl,
  parseFrontmatter,
  sanitizeSkillBody,
  scanSkillBodyRisks,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';
import { toAgentDto } from '../agents/helpers.js';
import { getCommunitySkillBody, searchCommunitySkills } from './community-catalog.js';
import {
  ALLOWED_IMPORT_CONTENT_TYPES,
  MAX_URL_IMPORT_BYTES,
  URL_IMPORT_TIMEOUT_MS,
} from './constants.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';

/**
 * A1 — skills service. Business logic for the Skills tab: CRUD + versioning
 * (mirrors AgentsService exactly), plus the three-way import preview (file /
 * url / community catalog), the community catalog passthrough, and the
 * per-agent skill-usage rollup.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  /** "What changed" note; only recorded when this patch snapshots a new body. */
  versionLabel?: string;
}

/** First non-empty, non-heading line of a markdown body, trimmed and capped — the
 *  synthesized description fallback when frontmatter has none. */
function synthesizeDescription(body: string): string {
  const MAX_LEN = 140;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    return line.length > MAX_LEN ? `${line.slice(0, MAX_LEN).trim()}` : line;
  }
  return '';
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.versionLabel !== undefined ? { versionLabel: patch.versionLabel } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Config history for a skill, newest version first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (the route maps that to 404).
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /**
   * A single body snapshot for a skill. Returns undefined when the skill isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /**
   * Agents this skill is linked to, as Agent DTOs. Workspace-scoped: undefined
   * when the skill isn't in this workspace. Ids that no longer resolve to an
   * agent (deleted between the link lookup and now) are silently dropped.
   */
  async agentsUsing(workspaceId: string, skillId: string): Promise<Agent[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const agentIds = await this.repo.agentIdsForSkill(skillId);
    const rows = await Promise.all(agentIds.map((id) => this.container.agentsRepo.getById(workspaceId, id)));
    return rows.filter((row): row is NonNullable<typeof row> => row !== undefined).map(toAgentDto);
  }

  /**
   * Preview an import from any of the three sources without persisting
   * anything. Derives name/description/type from the resulting markdown body
   * the same way regardless of source.
   */
  async importPreview(input: SkillImportRequest): Promise<SkillImportPreview> {
    let body: string;
    let skipped: string[];
    let source: SkillSource;

    if (input.source === 'file') {
      const bytes = Buffer.from(input.content_b64, 'base64');
      if (input.filename.toLowerCase().endsWith('.zip')) {
        try {
          ({ body, skipped } = extractSkillFromArchive(bytes));
        } catch (err) {
          throw new ValidationError(err instanceof Error ? err.message : String(err));
        }
      } else {
        body = bytes.toString('utf8');
        skipped = [];
      }
      source = 'manual';
    } else if (input.source === 'url') {
      body = await this.fetchUrlBody(input.url);
      skipped = [];
      source = 'imported_url';
    } else {
      const entry = getCommunitySkillBody(input.id);
      if (!entry) throw new NotFoundError(`No community skill with id "${input.id}"`);
      body = entry.body;
      skipped = [];
      source = 'community';
    }

    // A skill body is untrusted text headed for a model prompt. Reject anything
    // that is plainly a web page rather than a skill (a lying content-type, or
    // a file/archive that never had one), and strip invisible characters so the
    // preview a human vets is byte-for-byte what the model would receive.
    if (looksLikeHtml(body)) {
      throw new ValidationError(
        'That looks like an HTML page, not a skill. Link the raw markdown file instead.',
      );
    }
    body = sanitizeSkillBody(body);

    const frontmatter = parseFrontmatter(body);
    const name = deriveSkillName(body);
    const description = frontmatter.description ?? synthesizeDescription(body);
    const type = SkillTypeSchema.safeParse(frontmatter.type).success
      ? (frontmatter.type as SkillType)
      : 'custom';
    const warnings = scanSkillBodyRisks(body);

    return { name, description, type, body, source, skipped, warnings };
  }

  /**
   * SSRF guard: "import a skill from a URL" is a server-side fetch of an
   * attacker-controllable address, so before touching the network we (1) only
   * allow http(s), (2) resolve the hostname ourselves and reject any resolved
   * address that is loopback/private/link-local (blocks localhost, the Docker
   * network, and the cloud metadata endpoint), and (3) never follow redirects
   * — a redirect to an unchecked host would reopen the same hole. Resolving
   * DNS ourselves rather than letting `fetch` do it leaves a small DNS-rebinding
   * TOCTOU window (the two lookups happen milliseconds apart); closing that
   * fully would need a fetch agent that pins the checked IP, which is more
   * machinery than this local-first import feature warrants today.
   */
  private async fetchUrlBody(url: string): Promise<string> {
    let parsed: URL;
    try {
      // Rewrite a code-host page URL to the raw-markdown one FIRST, so the
      // SSRF checks below run against the address actually fetched.
      parsed = new URL(normalizeImportUrl(url));
    } catch {
      throw new ValidationError('Invalid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('Only http(s) URLs can be imported');
    }

    let addresses: { address: string }[];
    try {
      addresses = await lookup(parsed.hostname, { all: true });
    } catch {
      throw new ValidationError('Could not resolve that host');
    }
    if (addresses.length === 0 || addresses.some((a) => isDisallowedIp(a.address))) {
      throw new ValidationError(
        'That URL resolves to a private or reserved address and cannot be imported',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), URL_IMPORT_TIMEOUT_MS);

    let response: Response;
    try {
      // redirect: 'manual' — never silently follow a redirect to an unchecked host.
      response = await fetch(parsed, { signal: controller.signal, redirect: 'manual' });
    } catch (err) {
      throw new ValidationError(
        `Failed to fetch skill from URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new ValidationError('That URL redirected — redirects are not followed for imports');
    }

    if (!response.ok) {
      throw new ValidationError(`Failed to fetch skill from URL: HTTP ${response.status}`);
    }

    // Allowlist the markdown/plain subtypes rather than all of `text/*`: a skill
    // is markdown, and `text/html` means we'd be importing a whole rendered web
    // page — nav, scripts, embedded JSON — into a body bound for a model prompt.
    const contentType = response.headers.get('content-type') ?? '';
    const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ALLOWED_IMPORT_CONTENT_TYPES.includes(mediaType as never)) {
      throw new ValidationError(
        `Unsupported content-type "${mediaType || 'unknown'}" — link a raw markdown file ` +
          `(one of: ${ALLOWED_IMPORT_CONTENT_TYPES.join(', ')})`,
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_URL_IMPORT_BYTES) {
      throw new ValidationError(
        `Response is too large (${contentLength} > ${MAX_URL_IMPORT_BYTES} bytes max)`,
      );
    }

    if (!response.body) {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_URL_IMPORT_BYTES) {
        throw new ValidationError(
          `Response is too large (> ${MAX_URL_IMPORT_BYTES} bytes max)`,
        );
      }
      return text;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_URL_IMPORT_BYTES) {
          await reader.cancel();
          throw new ValidationError(
            `Response is too large (> ${MAX_URL_IMPORT_BYTES} bytes max)`,
          );
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  }

  // ---- stats ---------------------------------------------------------------

  /**
   * Stats for one skill. The repository returns raw numerators and denominators;
   * every ratio is computed here and is `null` when its denominator is zero, so
   * "no data yet" renders as "—" instead of a confident 0%.
   */
  async stats(
    workspaceId: string,
    skillId: string,
    days?: number,
  ): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;

    const window = clampStatsDays(days);
    const [agentsUsing, runs, skillUsingRuns, findings, byCategory] = await Promise.all([
      this.repo.agentsUsingCount(skillId),
      this.repo.skillRunCount(workspaceId, skillId, window),
      this.repo.workspaceSkillUsingRuns(workspaceId, window),
      this.repo.skillFindingCounts(workspaceId, skillId, window),
      this.repo.skillFindingsByCategory(workspaceId, skillId, window),
    ]);

    const triaged = findings.accepted + findings.dismissed;
    return {
      agents_using: agentsUsing,
      runs,
      pull_pct: skillUsingRuns > 0 ? Math.round((runs / skillUsingRuns) * 100) : null,
      accept_rate: triaged > 0 ? Math.round((findings.accepted / triaged) * 100) : null,
      findings: findings.total,
      by_category: byCategory.map((r) => ({ category: r.category, count: r.count })),
    };
  }

  /** One row per skill in the workspace, for the list rail. */
  async statsSummaries(workspaceId: string, days?: number): Promise<SkillStatsSummary[]> {
    const window = clampStatsDays(days);
    const [rows, skillUsingRuns] = await Promise.all([
      this.repo.skillSummaries(workspaceId, window),
      this.repo.workspaceSkillUsingRuns(workspaceId, window),
    ]);
    return rows.map((r) => {
      const triaged = r.accepted + r.dismissed;
      return {
        skill_id: r.skillId,
        agents_using: r.agentsUsing,
        pull_pct: skillUsingRuns > 0 ? Math.round((r.runs / skillUsingRuns) * 100) : null,
        accept_rate: triaged > 0 ? Math.round((r.accepted / triaged) * 100) : null,
      };
    });
  }

  /**
   * Restore a past body. Appends a NEW version carrying the old text rather than
   * rewinding: the intervening snapshots are what past eval runs were scored
   * against, so deleting them would make those runs unreproducible.
   */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const snapshot = await this.repo.getVersion(skillId, version);
    if (!snapshot) return undefined;
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;

    const row = await this.repo.update(workspaceId, skillId, {
      body: snapshot.body,
      versionLabel: `Restored from v${version}`,
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Synchronous passthrough to the in-repo community catalog — no I/O. */
  communityCatalog(q?: string, lang?: string): CommunitySkill[] {
    return searchCommunitySkills(q, lang);
  }

  /**
   * Per-skill usage for one agent over the last `days` days, as percentages of
   * that agent's skill-using runs in the window (see SkillsRepository.skillUsingRunCount
   * for why that — not total run count — is the denominator).
   */
  async usage(agentId: string, days: number): Promise<SkillUsage[]> {
    const [rows, denominator] = await Promise.all([
      this.repo.usageByAgent(agentId, days),
      this.repo.skillUsingRunCount(agentId, days),
    ]);
    return rows.map((row) => ({
      skill_id: row.skillId,
      name: row.name,
      type: row.type,
      runs: row.runs,
      pct: denominator === 0 ? 0 : Math.round((row.runs / denominator) * 100),
    }));
  }
}
