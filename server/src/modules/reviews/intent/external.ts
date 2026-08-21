import { lookup } from 'node:dns/promises';
import { isDisallowedIp, looksLikeHtml } from '../../_shared/net-guards.js';

/**
 * Tier (d) evidence: external URLs found in the PR body. Application layer
 * (network I/O), NOT pure. Gated OFF by `INTENT_EXTERNAL_EVIDENCE` — the
 * caller (`IntentService.deriveForRun`) must never invoke anything in this
 * file unless that flag is on, so the "no network call when off" guarantee
 * lives in the caller, not here.
 *
 * Security is the entire point of this file: this is a server-side fetch of
 * an attacker-controlled address (any URL the PR author's body happens to
 * contain). Mandatory reuse, per the Intent Layer plan (R-3) and the recorded
 * insight in `server/insights/INSIGHTS.md` (2026-08-04, the skills URL-import route):
 * the SSRF guard below mirrors `SkillsService.fetchUrlBody`
 * (`modules/skills/service.ts:239`) exactly — http(s) only, DNS-resolve the
 * hostname BEFORE fetching and reject loopback/private/link-local (including
 * the `169.254.169.254` cloud-metadata address), `redirect: 'manual'` so a
 * 30x is never silently followed, a hard timeout, a response-size cap, and
 * HTML rejection.
 *
 * Deliberately imports the PURE helpers (`isDisallowedIp`, `looksLikeHtml`)
 * from `modules/_shared/net-guards.js` rather than instantiating
 * `SkillsService`: this module needs the guard *shape*, not skills'
 * persistence/import semantics (warnings, versioning, community catalog),
 * and pulling in a DB-backed service would drag unrelated I/O into a "derive
 * intent" code path that must stay a cheap, one-shot, never-throwing fetch.
 * The fetch loop itself is mirrored (not imported) from `fetchUrlBody` for
 * the same reason: a different caller with a different failure contract —
 * `fetchUrlBody` throws `ValidationError` on every rejection (user-facing
 * import flow); this must NEVER throw (D5 — intent derivation can never fail
 * a review), so every rejection here degrades to "drop this URL" instead.
 */

const MAX_URLS = 2;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 200 * 1024; // 200 KB
/** Cap on how much of one fetched URL's body reaches the prompt. */
const MAX_EVIDENCE_CHARS = 4_000;

export interface FetchedUrlEvidence {
  url: string;
  body: string;
}

/** Bare http(s) URL tokens, in first-seen order, deduped. Pure — no I/O. */
const URL_RE = /https?:\/\/[^\s<>()"'`]+/gi;

export function extractExternalUrls(normalizedBody: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of normalizedBody.matchAll(URL_RE)) {
    const raw = match[0];
    if (!raw) continue;
    // Strip common trailing punctuation a sentence would leave attached
    // ("see https://example.com/x." → the URL, not "URL.").
    const cleaned = raw.replace(/[.,;:!?)\]]+$/, '');
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Fetch at most `MAX_URLS` http(s) URLs found in the normalized PR body,
 * through the SSRF guard described above. NEVER throws — a rejected or failed
 * fetch silently drops that URL; returns `[]` when nothing succeeded. The
 * caller decides whether a non-empty result contributes the `external_url`
 * confidence source.
 */
export async function fetchExternalUrlEvidence(
  normalizedBody: string,
): Promise<FetchedUrlEvidence[]> {
  const candidates = extractExternalUrls(normalizedBody).slice(0, MAX_URLS);
  const results: FetchedUrlEvidence[] = [];
  for (const url of candidates) {
    const body = await fetchOneGuarded(url);
    if (body !== undefined) results.push({ url, body });
  }
  return results;
}

/** One SSRF-guarded fetch. Returns `undefined` on ANY rejection — never throws. */
async function fetchOneGuarded(raw: string): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    return undefined;
  }
  if (addresses.length === 0 || addresses.some((a) => isDisallowedIp(a.address))) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    // redirect: 'manual' — a 30x must not be silently followed to an
    // unchecked host (that would reopen the exact hole the DNS check closes).
    response = await fetch(parsed, { signal: controller.signal, redirect: 'manual' });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }

  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return undefined;
  }
  if (!response.ok) return undefined;

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) return undefined;

  let text: string;
  try {
    if (!response.body) {
      text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return undefined;
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            return undefined;
          }
          chunks.push(value);
        }
      }
      text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    }
  } catch {
    return undefined;
  }

  if (looksLikeHtml(text)) return undefined;
  return text.slice(0, MAX_EVIDENCE_CHARS);
}
