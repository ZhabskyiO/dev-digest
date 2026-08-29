/**
 * Validates an externally-sourced URL before it is used as an `<a href>` —
 * React does NOT sanitize `href`, so an unvalidated `javascript:`/`data:`
 * string coming from ingested/server data (e.g. a GitHub run/PR URL) executes
 * on click. Returns the original string only when it parses as an absolute
 * `http:`/`https:` URL (optionally restricted to a given host), otherwise
 * `null` so the caller can render a safe fallback instead of a live link.
 */
export function safeHttpUrl(url: string | null | undefined, opts: { host?: string } = {}): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (opts.host && parsed.hostname !== opts.host) return null;
  return url;
}

/** Same guard, restricted to `github.com` — every external link this app
 *  renders from ingested data (a CI run's `github_url`, an export's
 *  `pr_url`) is expected to point at GitHub. */
export function safeGithubUrl(url: string | null | undefined): string | null {
  return safeHttpUrl(url, { host: "github.com" });
}
