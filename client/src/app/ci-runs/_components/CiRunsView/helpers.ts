import type { CiRunsQuery, CiRunStatus } from "@devdigest/shared";
import { STATUS_VALUES, WINDOW_VALUES, type CiWindowValue } from "./constants";

/** Build the `CiRunsQuery` sent to `useCiRuns` straight from the URL search
 *  params — filters live in the URL (never component state), so a shared
 *  link or a refresh reproduces the exact same filtered view. Unknown/absent
 *  values fall back to the query's own defaults rather than erroring. */
export function queryFromParams(params: URLSearchParams): CiRunsQuery {
  const windowParam = params.get("window");
  const agentId = params.get("agent_id");
  const repo = params.get("repo");
  const status = params.get("status");

  const query: CiRunsQuery = {
    window: isWindowValue(windowParam) ? windowParam : "7d",
  };
  if (agentId) query.agent_id = agentId;
  if (repo) query.repo = repo;
  if (isStatusValue(status)) query.status = status;
  return query;
}

function isWindowValue(v: string | null): v is CiWindowValue {
  return !!v && (WINDOW_VALUES as readonly string[]).includes(v);
}

function isStatusValue(v: string | null): v is CiRunStatus {
  return !!v && (STATUS_VALUES as readonly string[]).includes(v);
}

/** `YYYY-MM-DD HH:MM` for a run timestamp, "—" when unknown/unparsable. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
