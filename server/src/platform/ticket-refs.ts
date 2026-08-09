/**
 * Closing-keyword-qualified issue reference extraction — shared between the
 * Intent Layer (`modules/reviews/intent/evidence.ts`) and the GitHub adapter
 * (`adapters/github/octokit.ts`). Lives in `platform/` (not a `modules/*`
 * folder) because an infrastructure adapter must not import a feature module
 * (`adapters-dont-know-modules`, `server/.dependency-cruiser.cjs`) — this is
 * the one destination both an adapter and an application-layer module may
 * import from. Pure — no I/O, no DB, no adapters.
 */

export interface TicketRef {
  owner?: string;
  repo?: string;
  number: number;
  crossRepo: boolean;
}

/**
 * Closing-keyword-qualified issue references only — a bare `#123` is NOT a
 * linked issue. All nine GitHub closing keywords, case-insensitive, an
 * optional `:`, and an optional `owner/repo` cross-repo prefix. This is the
 * single definition — the GitHub adapter (T8) imports it rather than
 * duplicating it.
 */
const TICKET_REF_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)/gi;

export function extractTicketRefs(body: string): TicketRef[] {
  const seen = new Set<string>();
  const refs: TicketRef[] = [];

  for (const match of body.matchAll(TICKET_REF_RE)) {
    // noUncheckedIndexedAccess: regex capture groups are `string | undefined`.
    const numberStr = match[2];
    if (!numberStr) continue;
    const number = Number(numberStr);
    if (!Number.isFinite(number)) continue;

    const ownerRepo = match[1];
    const dedupeKey = ownerRepo ? `${ownerRepo}#${number}` : `#${number}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let owner: string | undefined;
    let repo: string | undefined;
    if (ownerRepo) {
      const parts = ownerRepo.split('/');
      owner = parts[0];
      repo = parts[1];
    }

    refs.push({
      ...(owner !== undefined ? { owner } : {}),
      ...(repo !== undefined ? { repo } : {}),
      number,
      crossRepo: Boolean(ownerRepo),
    });
  }

  return refs;
}
