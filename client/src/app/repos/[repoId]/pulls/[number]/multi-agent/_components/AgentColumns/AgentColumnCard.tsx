/* AgentColumnCard — one agent's result column. Header status is driven
   entirely by props: `column.status` for the terminal states, and while
   `running` a live label from the parent's shared event stream, filtered to
   this run (AC-34). This component NEVER opens its own EventSource. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon } from "@devdigest/ui";
import type { AgentColumn, RunEvent } from "@devdigest/shared";
import { formatCostUsd, formatDurationMs } from "@/lib/format";
import { STATUS_META } from "./constants";
import { eventsForRun, latestRunMessage } from "./helpers";
import { FindingMiniCard } from "./FindingMiniCard";
import { s } from "./styles";

export function AgentColumnCard({
  column,
  liveEvents,
  onOpenTrace,
}: {
  column: AgentColumn;
  /** The parent's shared `useRunEvents` stream for the whole multi-run —
   *  filtered to this column's `run_id` below. */
  liveEvents: RunEvent[];
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");
  const meta = STATUS_META[column.status];
  const StatusIcon = Icon[meta.icon];

  const runEvents = eventsForRun(liveEvents, column.run_id);
  const liveMessage = column.status === "running" ? latestRunMessage(runEvents) : null;
  const statusLabel = liveMessage ?? t(`page.results.${meta.labelKey}`);

  return (
    <div style={s.column(meta.color)} data-run-id={column.run_id} data-status={column.status}>
      <div style={s.header}>
        <div style={s.headerTop}>
          <span style={s.statusBadge(meta.color, meta.bg)} title={t(`page.results.${meta.labelKey}`)}>
            <StatusIcon size={12.5} />
            <span style={s.statusLabel}>{statusLabel}</span>
          </span>
          {column.score != null && <CircularScore score={column.score} size={34} stroke={3} />}
        </div>
        <div style={s.name}>{column.agent_name}</div>
        <div style={s.meta}>
          {formatDurationMs(column.duration_ms)} · {formatCostUsd(column.cost_usd)}
        </div>
      </div>

      <div style={s.body}>
        {column.status === "failed" && column.error && (
          <div style={s.errorBox}>{t("page.results.columnError", { reason: column.error })}</div>
        )}
        {column.status === "cancelled" && (
          <div style={s.cancelledBox}>{t("page.results.statusCancelled")}</div>
        )}
        {column.findings.map((finding) => (
          <FindingMiniCard key={finding.id} finding={finding} />
        ))}
      </div>

      <div style={s.footer}>
        <button type="button" style={s.traceLink} onClick={() => onOpenTrace(column.run_id)}>
          {t("page.results.viewTrace")}
        </button>
        <span style={s.findingsCount}>
          {t("page.results.findingsCount", { count: column.findings.length })}
        </span>
      </div>
    </div>
  );
}
