/* AgentTabs — Multi-Agent Review "Tabs" mode. One tab per agent (name +
   score, scrollable strip — Q7); the selected tab shows an agent summary
   card (score, summary, duration, cost, trace link) and that agent's
   findings as the existing `FindingCard`, reused verbatim (AC-39, AC-40).
   Accept/dismiss and "Turn into eval case" go through the same mutation
   hooks the single-review FindingsPanel uses, then invalidate the
   multi-agent run query so the card reflects its new state without a full
   reload (AC-41, AC-42). "Learn"/"reply" aren't wired to a real endpoint on
   this surface yet, so they render as disabled controls (AC-43). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CircularScore, Tabs, EmptyState } from "@devdigest/ui";
import type { AgentColumn, FindingActionKind, FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/evals";
import { formatCostUsd, formatDurationMs, NO_VALUE } from "@/lib/format";
import { FindingCard } from "../../../_components/FindingCard";
import { UNAVAILABLE_ACTIONS } from "./constants";
import { s } from "./styles";

export interface AgentTabsProps {
  columns: AgentColumn[];
  /** The PR id — threaded through `useFindingAction` and used to invalidate
   *  `["multi-agent-run", prId]` after an accept/dismiss/eval-case mutation. */
  prId: string;
  /** Open the trace + log drawer for the selected tab's run. */
  onOpenTrace: (runId: string) => void;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function AgentTabs({ columns, prId, onOpenTrace, repoFullName, headSha }: AgentTabsProps) {
  const t = useTranslations("runs");
  const tFinding = useTranslations("prReview");
  const qc = useQueryClient();
  const action = useFindingAction();
  const evalCase = useCreateEvalCaseFromFinding();
  const [activeRunId, setActiveRunId] = React.useState<string | undefined>(columns[0]?.run_id);
  const [confirmation, setConfirmation] = React.useState<{ findingId: string; text: string } | null>(
    null,
  );

  const active = columns.find((c) => c.run_id === activeRunId) ?? columns[0];

  const invalidateRun = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["multi-agent-run", prId] });
  }, [qc, prId]);

  const handleAction = (findingId: string, act: FindingActionKind) => {
    action.mutate({ findingId, action: act, prId }, { onSuccess: invalidateRun });
  };

  const handleEvalCase = (findingId: string) => {
    evalCase.mutate(
      { findingId },
      {
        onSuccess: (d) => {
          invalidateRun();
          setConfirmation({
            findingId,
            text: d.created
              ? tFinding("panel.evalCaseCreated", {
                  name: d.case.name,
                  type: d.case.expectation?.type ?? "",
                })
              : tFinding("panel.evalCaseExists", { name: d.case.name }),
          });
        },
      },
    );
  };

  if (!active) return null;

  const tabs = columns.map((c) => ({
    key: c.run_id,
    label: `${c.agent_name} · ${c.score != null ? c.score : NO_VALUE}`,
  }));

  return (
    <div style={s.wrap}>
      <div style={s.tabStrip}>
        <Tabs tabs={tabs} value={active.run_id} onChange={setActiveRunId} pad="0" />
      </div>

      <Card style={s.summaryCard}>
        {active.score != null && <CircularScore score={active.score} size={52} stroke={5} />}
        <div style={s.summaryMain}>
          <div style={s.summaryTitleRow}>
            <span style={s.agentName}>{active.agent_name}</span>
          </div>
          {active.summary && <p style={s.summaryText}>{active.summary}</p>}
          {active.status === "failed" && active.error && (
            <p style={s.errorText}>{t("page.results.columnError", { reason: active.error })}</p>
          )}
          <div style={s.summaryMeta}>
            <span>{formatDurationMs(active.duration_ms)}</span>
            <span>{formatCostUsd(active.cost_usd)}</span>
            <button type="button" style={s.traceLink} onClick={() => onOpenTrace(active.run_id)}>
              {t("page.results.viewTrace")}
            </button>
          </div>
        </div>
      </Card>

      <div style={s.findingsList}>
        <div style={s.findingsHeading}>
          {t("page.results.findingsCount", { count: active.findings.length })}
        </div>
        {active.findings.length === 0 ? (
          <EmptyState icon="CheckCircle" title={tFinding("findingsCard.empty")} />
        ) : (
          active.findings.map((f) => (
            <React.Fragment key={f.id}>
              <FindingCard
                // `AgentColumnFinding.category` is a deliberately un-narrowed
                // `z.string()` on the vendored contract (kept that way so a
                // hand-typed literal stays assignable to `FindingRecord` via
                // `satisfies` — see `contracts/observability.ts`'s own
                // comment); a value read out of a `columns` PROP loses that
                // per-literal narrowing, so the cast is required here even
                // though the runtime value is always one of the same
                // `FindingCategory` members `FindingRecord` expects.
                f={f as FindingRecord}
                pending={action.isPending && action.variables?.findingId === f.id}
                evalPending={evalCase.isPending && evalCase.variables?.findingId === f.id}
                onAction={(act) => handleAction(f.id, act)}
                onEvalCase={() => handleEvalCase(f.id)}
                repoFullName={repoFullName}
                headSha={headSha}
                unavailableActions={UNAVAILABLE_ACTIONS}
              />
              {confirmation?.findingId === f.id && (
                <p role="status" style={s.confirmation}>
                  {confirmation.text}
                </p>
              )}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}
