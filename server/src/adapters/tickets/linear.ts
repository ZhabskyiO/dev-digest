import type { SecretsProvider, TicketProvider } from '@devdigest/shared';

const FETCH_TIMEOUT_MS = 8_000;
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

/**
 * Linear GraphQL ticket lookup — Intent Layer tier (e), gated OFF by
 * `INTENT_EXTERNAL_EVIDENCE`. Same credential contract as
 * `JiraTicketProvider`: the API key comes ONLY through the injected
 * `SecretsProvider`, never read directly from the OS-level environment, a
 * dotenv file, or `AppConfig`, and any missing credential or failed lookup
 * degrades to `undefined` — never a throw.
 */
export class LinearTicketProvider implements TicketProvider {
  constructor(private secrets: SecretsProvider) {}

  async fetchTicket(
    key: string,
  ): Promise<{ key: string; title: string; description: string } | undefined> {
    const apiKey = await this.secrets.get('LINEAR_API_KEY');
    if (!apiKey) return undefined;

    const parsedKey = parseIssueKey(key);
    if (!parsedKey) return undefined;

    const query = `
      query($teamKey: String!, $number: Float!) {
        issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
          nodes { identifier title description }
        }
      }
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { teamKey: parsedKey.teamKey, number: parsedKey.number },
        }),
      });
      if (!response.ok) return undefined;

      const data = (await response.json()) as {
        data?: {
          issues?: { nodes?: { identifier?: string; title?: string; description?: string }[] };
        };
      };
      const node = data.data?.issues?.nodes?.[0];
      if (!node?.title) return undefined;

      return {
        key: node.identifier ?? key,
        title: node.title,
        description: node.description ?? '',
      };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** `"ENG-123"` → `{ teamKey: "ENG", number: 123 }`. `undefined` when the shape doesn't match. */
function parseIssueKey(key: string): { teamKey: string; number: number } | undefined {
  const match = /^([A-Z][A-Z0-9]+)-(\d+)$/.exec(key);
  if (!match) return undefined;
  const teamKey = match[1];
  const numberStr = match[2];
  if (!teamKey || !numberStr) return undefined;
  const number = Number(numberStr);
  if (!Number.isFinite(number)) return undefined;
  return { teamKey, number };
}
