import { Intent } from '@devdigest/shared';
import type { IntentConfidenceTier, IntentSource } from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import type { RunLogger } from '../../../platform/run-logger.js';
import { renderPrompt } from '../../../platform/prompts.js';
import { resolveFeatureModel, getTicketProjectKeys } from '../../settings/feature-models.js';
import type { PullRow, IntentRow, RepoRow } from '../repository.js';
import { computeIntentConfidence } from './confidence.js';
import {
  normalizeBody,
  isSubstantiveProse,
  extractTicketRefs,
  extractDocRefs,
  changedPathDigest,
  wrapEvidence,
} from './evidence.js';
import { readDocRefs } from './docs.js';
import { fetchExternalUrlEvidence } from './external.js';

/**
 * The shape `reviewer-core`'s prompt slot expects (`PromptParts['intent']`).
 * Deliberately re-declared here rather than imported — reviewer-core does not
 * export a standalone name for this inline type, and this module must not
 * import a review-engine type just for a string-literal union.
 */
export interface PromptIntentSlot {
  statement: string;
  inScope: string[];
  outOfScope: string[];
  confidence: IntentConfidenceTier;
}

/** Map a persisted `pr_intent` row to the prompt-slot shape. */
export function toPromptSlot(row: IntentRow): PromptIntentSlot {
  return {
    statement: row.intent,
    inScope: row.inScope,
    outOfScope: row.outOfScope,
    confidence: row.confidence as IntentConfidenceTier,
  };
}

/** `abc1234…` — first 7 chars of a commit sha, for log lines. */
function shortSha(sha: string): string {
  return sha.slice(0, 7) || '(empty)';
}

/** `1.2k` for >=1000, otherwise the plain integer. */
function formatTokenCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatCost(costUsd: number | null): string {
  return costUsd === null ? '—' : `$${costUsd.toFixed(4)}`;
}

/**
 * Jira/Linear-style ticket keys (`PROJECT-123`) found in `text`, restricted to
 * an explicit per-workspace project-key allowlist. The bare pattern
 * `[A-Z][A-Z0-9]+-\d+` is noisy on its own — it matches `UTF-8`, `HTTP-2`,
 * `COVID-19` — so with no allowlist configured this returns nothing rather
 * than guessing which matches are real ticket keys (Intent Layer plan, T16).
 */
const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;

function extractTicketKeys(text: string, allowlist: string[]): string[] {
  if (allowlist.length === 0) return [];
  const allowed = new Set(allowlist.map((p) => p.toUpperCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(TICKET_KEY_RE)) {
    const prefix = match[1];
    const number = match[2];
    if (!prefix || !number) continue;
    if (!allowed.has(prefix.toUpperCase())) continue;
    const key = `${prefix}-${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Derives a PR's stated intent — the Intent Layer (L03). See
 * `.claude/plans/intent-adaptive-bentley.md` §2 for the full call sequence.
 *
 * Onion rules: consumes `container.<port>` only, never a concrete adapter
 * class; never reads secrets from `process.env` (only through the injected
 * SecretsProvider, indirectly via `container.llm()`/`container.github()`).
 *
 * D5 — intent derivation can NEVER fail a review. Every public entry point
 * degrades to `undefined` on ANY failure (missing provider key, a model that
 * can't honour structured output, schema failure after retries, timeout,
 * GitHub 404, unreadable clone path, or the `upsertIntent` write itself) —
 * see the single try/catch in `deriveForRun`.
 */
export class IntentService {
  private repo: Container['reviewRepo'];

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
  }

  /**
   * Derive (or reuse the cached) intent for one PR. Called ONCE per
   * `executeRuns`, before the per-agent loop — see run-executor.ts.
   *
   * Returns `undefined` when: `INTENT_ENABLED=false`, or ANY failure occurs
   * during derivation. Never throws.
   */
  async deriveForRun(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    runLog: RunLogger,
  ): Promise<PromptIntentSlot | undefined> {
    if (!this.container.config.intentEnabled) {
      runLog.info('Intent disabled (INTENT_ENABLED=false) — skipping derivation');
      return undefined;
    }

    try {
      // ---- cache check --------------------------------------------------
      const cached = await this.repo.getIntent(pull.id);
      if (cached && cached.headSha === pull.headSha) {
        runLog.info(
          `Intent cache hit for head_sha ${shortSha(cached.headSha)} (derived ${cached.derivedAt.toISOString()})`,
        );
        return toPromptSlot(cached);
      }

      // ---- tier (a): already in hand / one read each --------------------
      const body = pull.body ?? '';
      const normalizedBody = normalizeBody(body);

      const commitRows = await this.repo.getPrCommits(pull.id);
      const commitMessages = commitRows.map((r) => r.message);

      const files = await this.repo.getPrFiles(pull.id);
      const pathDigest = changedPathDigest(
        files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      );

      const sources: IntentSource[] = ['title', 'branch', 'commits', 'paths'];
      if (isSubstantiveProse(normalizedBody)) sources.push('prose_body');

      // ---- tier (b): linked GitHub issue(s) — best-effort ----------------
      const ticketRefs = extractTicketRefs(body);
      const sameRepoRefs = ticketRefs.filter((r) => !r.crossRepo);
      const crossRepoRefs = ticketRefs.filter((r) => r.crossRepo);
      if (crossRepoRefs.length > 0) sources.push('ticket_cross_repo');

      let ticketText = '(none)';
      if (sameRepoRefs.length > 0) {
        try {
          const github = await this.container.github();
          const issues = await github.getIssues(
            { owner: repo.owner, name: repo.name },
            sameRepoRefs.map((r) => r.number),
          );
          if (issues.length > 0) {
            sources.push('ticket');
            ticketText = issues
              .map((i) => `#${i.number} ${i.title}\n${i.body ?? ''}`.trim())
              .join('\n\n');
          }
        } catch (err) {
          // Best-effort: a GitHub failure (404, missing token, rate limit)
          // drops the source, never throws.
          runLog.info(`Intent evidence: linked issue fetch failed — ${(err as Error).message}`);
        }
      }
      if (crossRepoRefs.length > 0) {
        const crossNote = crossRepoRefs
          .map((r) => `${r.owner}/${r.repo}#${r.number} (cross-repo, not fetched)`)
          .join(', ');
        ticketText = ticketText === '(none)' ? crossNote : `${ticketText}\n\n${crossNote}`;
      }

      // ---- tier (c): in-repo doc/spec refs — best-effort -----------------
      const docRefs = extractDocRefs(normalizedBody);
      let docsText = '(none)';
      let docPaths: string[] = [];
      try {
        const docs = await readDocRefs(repo.clonePath, docRefs);
        if (docs.length > 0) {
          sources.push('spec_doc');
          docPaths = docs.map((d) => d.path);
          docsText = docs.map((d) => `${d.path}\n${d.body}`).join('\n\n');
        }
      } catch (err) {
        // Never let a doc-read failure break derivation.
        runLog.info(`Intent evidence: doc read failed — ${(err as Error).message}`);
      }

      // ---- tiers (d)/(e): external URLs + Jira/Linear — gated OFF -------
      // Both best-effort, both inside this same guarding try/catch, both
      // reachable ONLY when INTENT_EXTERNAL_EVIDENCE=true. With the flag off
      // (the default), neither `fetchExternalUrlEvidence` nor
      // `this.container.tickets` is ever referenced — no network call, no
      // ticket-provider construction. `intent.extract.md` (T3, fixed) has no
      // dedicated placeholder for these tiers, so their evidence is folded
      // into the existing `{{docs}}` / `{{ticket}}` sections rather than
      // widening the template.
      if (this.container.config.intentExternalEvidenceEnabled) {
        try {
          const fetched = await fetchExternalUrlEvidence(normalizedBody);
          if (fetched.length > 0) {
            sources.push('external_url');
            const externalText = fetched
              .map((f) => `External URL: ${f.url}\n${f.body}`)
              .join('\n\n');
            docsText = docsText === '(none)' ? externalText : `${docsText}\n\n${externalText}`;
          }
        } catch (err) {
          // Never let an external-URL fetch failure break derivation.
          runLog.info(`Intent evidence: external URL fetch failed — ${(err as Error).message}`);
        }

        try {
          const allowlist = await getTicketProjectKeys(this.container, workspaceId);
          const candidateKeys = extractTicketKeys(`${pull.title}\n${pull.branch}\n${body}`, allowlist);
          const firstKey = candidateKeys[0];
          if (firstKey) {
            const ticket = await this.container.tickets.fetchTicket(firstKey);
            if (ticket) {
              sources.push('ticket');
              const ticketBlock = `${ticket.key} ${ticket.title}\n${ticket.description}`.trim();
              ticketText = ticketText === '(none)' ? ticketBlock : `${ticketText}\n\n${ticketBlock}`;
            }
          }
        } catch (err) {
          // Never let a ticket-provider failure break derivation.
          runLog.info(`Intent evidence: ticket provider fetch failed — ${(err as Error).message}`);
        }
      }

      // ---- confidence — server-side, BEFORE the LLM call -----------------
      const confidence = computeIntentConfidence(sources);
      runLog.info(`Intent evidence: ${describeEvidence(confidence.sources, sameRepoRefs, docPaths)}`);
      runLog.info(
        `Intent confidence: ${confidence.tier} (${confidence.score}) — ${confidence.sources.length} source(s)`,
      );

      // ---- render + call the model ----------------------------------------
      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
      const llm = await this.container.llm(provider);

      const prompt = await renderPrompt('intent.extract.md', {
        title: wrapEvidence('title', pull.title),
        branch: wrapEvidence('branch', pull.branch),
        commits: wrapEvidence('commits', commitMessages.length > 0 ? commitMessages.join('\n') : '(no commits)'),
        paths: wrapEvidence('paths', pathDigest),
        body: wrapEvidence('body', body || '(no description)'),
        ticket: wrapEvidence('ticket', ticketText),
        docs: wrapEvidence('docs', docsText),
      });

      const res = await llm.completeStructured<Intent>({
        model,
        schema: Intent,
        schemaName: 'Intent',
        messages: [{ role: 'user', content: prompt }],
      });

      // ---- persist (still inside the guarding try/catch) -----------------
      await this.repo.upsertIntent(pull.id, {
        intent: res.data,
        headSha: pull.headSha,
        confidence: confidence.tier,
        confidenceScore: confidence.score,
        sources: confidence.sources,
        provider,
        model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
      });

      runLog.result(
        `Intent derived via ${provider}/${model} — ${formatTokenCount(res.tokensIn)} in / ${formatTokenCount(res.tokensOut)} out, ${formatCost(res.costUsd)}`,
      );

      return {
        statement: res.data.intent,
        inScope: res.data.in_scope,
        outOfScope: res.data.out_of_scope,
        confidence: confidence.tier,
      };
    } catch (err) {
      // D5 — the hard requirement: intent derivation can NEVER fail a review.
      // The parenthetical is mandatory — a red Live Log line here must not be
      // misread as a failed run.
      runLog.error(`Intent derivation failed (review continues without intent): ${(err as Error).message}`);
      return undefined;
    }
  }
}

/** Render the evidence-list log line, e.g. "title, branch, commits, paths, prose_body, ticket#412, spec_doc(docs/plans/x.md)". */
function describeEvidence(
  sources: IntentSource[],
  sameRepoRefs: { number: number }[],
  docPaths: string[],
): string {
  return sources
    .map((s) => {
      // `sameRepoRefs` can be empty here even though 'ticket' is present — a
      // tier-(e) Jira/Linear hit (T16) contributes the same 'ticket' source
      // without a GitHub issue number to show.
      if (s === 'ticket') {
        return sameRepoRefs.length > 0
          ? `ticket#${sameRepoRefs.map((r) => r.number).join(',')}`
          : 'ticket';
      }
      if (s === 'spec_doc') return `spec_doc(${docPaths.join(', ')})`;
      return s;
    })
    .join(', ');
}
