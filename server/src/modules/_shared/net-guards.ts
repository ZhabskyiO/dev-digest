/**
 * SSRF-adjacent guards shared across modules that fetch a server-side URL
 * supplied (directly or indirectly) by a user: reject requests aimed at a
 * loopback/private/link-local address, and reject a response whose body is
 * actually HTML despite whatever `content-type` it claims.
 *
 * Moved out of `modules/skills/helpers.ts` (originally written for the
 * skills URL-import flow) so `modules/reviews/intent/external.ts` can reuse
 * the exact same guard without a module→module internal import
 * (`no-cross-module-internals` in `.dependency-cruiser.cjs`) — `_shared` is
 * the documented common ground for exactly this kind of reuse. Security
 * code: do not change the logic here without re-checking every caller.
 */

/** How much of the body to sniff when double-checking a lying content-type. */
const HTML_SNIFF_CHARS = 2048;

/**
 * True when `ip` (a resolved IPv4/IPv6 literal) is loopback, private, link-local
 * (including the `169.254.169.254` cloud-metadata address), or otherwise not a
 * safe target for a server-side fetch. Used by URL-import/fetch SSRF guards: a
 * URL is resolved via DNS first, and any resolved address failing this check is
 * rejected before the actual fetch happens — otherwise a "fetch this URL"
 * feature is a ready-made SSRF into this server's own network (internal
 * services, cloud metadata endpoints, localhost).
 */
export function isDisallowedIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const parts = v4.split('.').map(Number);
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → fail closed
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 0) return true; // "this network"
    return false;
  }
  // IPv6 (anything not matched above, incl. non-mapped IPv6 literals).
  const norm = ip.toLowerCase();
  if (norm === '::1') return true; // loopback
  if (norm.startsWith('fe80:')) return true; // link-local
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique local (fc00::/7)
  if (!/^[0-9a-f:]+$/.test(norm)) return true; // not a real IP literal → fail closed
  return false;
}

/**
 * Content sniff for HTML, because a `content-type` header is only the server's
 * claim. Checked against the head of the body, where a doctype or root tag
 * lives; also catches the JSON-escaped (`<`) markup that code hosts embed
 * in their page payloads.
 */
export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, HTML_SNIFF_CHARS).toLowerCase();
  if (/<!doctype\s+html/.test(head)) return true;
  if (/<html[\s>]/.test(head)) return true;
  if (/<(head|body|meta|script|link)[\s>]/.test(head)) return true;
  if (/\\u003c(!doctype|html|head|body|script|div|p)[\s\\>]/.test(head)) return true;
  return false;
}
