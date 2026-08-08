import type { SecretsProvider, TicketProvider } from '@devdigest/shared';

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Jira Cloud REST v3 ticket lookup — Intent Layer tier (e), gated OFF by
 * `INTENT_EXTERNAL_EVIDENCE`.
 *
 * Credentials come ONLY through the injected `SecretsProvider`
 * (`~/.devdigest/secrets.json`, mode 0600) — NEVER read from the process
 * environment directly, NEVER `.env`, NEVER `AppConfig` (which deliberately
 * excludes secrets; see `platform/config.ts`). A missing credential is not an error: `fetchTicket`
 * returns `undefined` so the caller degrades to "no ticket evidence", exactly
 * like a `GitHubClient.getIssue` failure already degrades in
 * `IntentService.deriveForRun`.
 *
 * Base URL, email, and API token are operator-configured (entered via the
 * Settings UI, same trust level as `GITHUB_TOKEN`), not attacker-controlled —
 * unlike tier (d)'s PR-body URLs, so this adapter does not need the SSRF
 * guard `intent/external.ts` uses.
 */
export class JiraTicketProvider implements TicketProvider {
  constructor(private secrets: SecretsProvider) {}

  async fetchTicket(
    key: string,
  ): Promise<{ key: string; title: string; description: string } | undefined> {
    const baseUrl = await this.secrets.get('JIRA_BASE_URL');
    const email = await this.secrets.get('JIRA_EMAIL');
    const token = await this.secrets.get('JIRA_API_TOKEN');
    if (!baseUrl || !email || !token) return undefined;

    let url: URL;
    try {
      url = new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, baseUrl);
    } catch {
      return undefined;
    }
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      });
      if (!response.ok) return undefined;

      const data = (await response.json()) as {
        key?: string;
        fields?: { summary?: string; description?: unknown };
      };
      const title = data.fields?.summary;
      if (!title) return undefined;

      return {
        key: data.key ?? key,
        title,
        description: extractPlainText(data.fields?.description),
      };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Jira's `description` field is Atlassian Document Format — a rich-text node
 * tree, not a string. Flatten it to plain text for the prompt; a depth guard
 * keeps a malformed/cyclical-looking payload from recursing unboundedly.
 * Never throws — any shape it doesn't recognise contributes empty text.
 */
function extractPlainText(node: unknown, depth = 0): string {
  if (depth > 20 || node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    return node
      .map((n) => extractPlainText(n, depth + 1))
      .filter(Boolean)
      .join(' ');
  }
  if (typeof node === 'object') {
    const obj = node as { text?: unknown; content?: unknown };
    if (typeof obj.text === 'string') return obj.text;
    if (obj.content !== undefined) return extractPlainText(obj.content, depth + 1);
  }
  return '';
}
