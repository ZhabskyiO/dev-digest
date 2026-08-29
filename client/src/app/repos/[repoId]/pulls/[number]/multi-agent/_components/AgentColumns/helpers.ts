/* Pure helpers for AgentColumns — no I/O, no translation calls (those stay in
   the component so the catalogue key list is greppable from one file). */
import type { AgentColumnFinding, RunEvent } from "@devdigest/shared";

/** "11" for a single-line finding, "11-15" for a range. */
export function lineLabel(f: Pick<AgentColumnFinding, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/**
 * Filter the parent's single shared event stream down to one run. The parent
 * owns the one `useRunEvents` subscription for the whole multi-run — this
 * component NEVER opens its own `EventSource`, it only reads what it's given.
 */
export function eventsForRun(events: RunEvent[], runId: string): RunEvent[] {
  return events.filter((e) => e.runId === runId);
}

/** The most recent live-log message for a running column, or `null` before
 *  the first event for that run has arrived (caller falls back to the
 *  generic "Running…" catalogue label in that case). */
export function latestRunMessage(events: RunEvent[]): string | null {
  if (events.length === 0) return null;
  return events[events.length - 1]?.msg ?? null;
}
