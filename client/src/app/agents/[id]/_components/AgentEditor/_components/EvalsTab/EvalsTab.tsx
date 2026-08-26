/* EvalsTab — the agent's regression harness (L07). Metric tiles from the
   latest batch (delta vs the previous one), the eval-case set born from real
   accept/dismiss decisions, and the batch history with a two-run side-by-side
   compare ("old prompt vs new"). Scoring is server-side, code-only. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, IconBtn, MetricCard, Modal, Skeleton } from "@devdigest/ui";
import type { Agent, EvalBatch, EvalCaseSummary } from "@devdigest/shared";
import {
  useDeleteEvalCase,
  useEvalCases,
  useEvalRuns,
  useRunEvalCase,
  useRunEvals,
} from "../../../../../../../lib/hooks/evals";
import { CaseEditorModal } from "@/components/eval-case-editor";
import { TrendChart } from "./_components/TrendChart";
import { notify } from "../../../../../../../lib/toast";
import { formatCostUsd, NO_VALUE } from "../../../../../../../lib/format";
import { deltaPts, fmtRanAt, orderPair, pct } from "./helpers";
import { s } from "./styles";

const METRICS = [
  { key: "recall", color: "var(--accent)" },
  { key: "precision", color: "var(--ok)" },
  { key: "citation_accuracy", color: "var(--warn)" },
] as const;


/** In-flight indicator that replaces the play button while a case runs. */
function RunningChip({ label }: { label: string }) {
  return (
    <span
      data-testid="case-running"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: "var(--text-secondary)",
        padding: "0 4px",
        whiteSpace: "nowrap",
      }}
    >
      <Icon.RefreshCw size={13} className="dd-spin" style={{ color: "var(--accent)" }} />
      {label}
    </span>
  );
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: runs, isLoading: runsLoading } = useEvalRuns(agent.id);
  const runAll = useRunEvals(agent.id);
  const runOne = useRunEvalCase({ kind: "agent", id: agent.id });
  const del = useDeleteEvalCase({ kind: "agent", id: agent.id });
  const router = useRouter();
  const [editor, setEditor] = React.useState<null | { existing: EvalCaseSummary | null }>(null);

  const [selected, setSelected] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);

  const latest = runs?.[0];
  const prev = runs?.[1];
  const passing = (cases ?? []).filter((c) => c.last_run?.pass === true).length;

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur.slice(-1), id],
    );
  const pair = (runs ?? []).filter((b) => selected.includes(b.batch_id));

  const onRunAll = () =>
    runAll.mutate(undefined, {
      onSuccess: (d) =>
        notify.success(t("evalsTab.runDone", { passed: d.batch.passed, total: d.batch.total })),
      onError: (e) =>
        notify.error(
          t("evalsTab.runFailed", { message: e instanceof Error ? e.message : String(e) }),
        ),
    });

  const onRunOne = (c: EvalCaseSummary) =>
    runOne.mutate(
      { caseId: c.id },
      {
        onSuccess: (d) => {
          const pass = d.result.per_trace[0]?.pass;
          const status = pass ? t("evalsTab.passed") : t("evalsTab.failed");
          (pass ? notify.success : notify.error)(
            t("evalsTab.caseRunResult", { name: c.name, status }),
          );
        },
        onError: (e) => notify.error(e instanceof Error ? e.message : String(e)),
      },
    );

  return (
    <div style={s.wrap}>
      {/* ---- metric tiles (latest batch, delta vs previous) ---- */}
      <div style={s.metricsHeader}>
        <span style={s.metricsTitle}>{t("evalsTab.metricsTitle")}</span>
        <button type="button" style={s.dashLink} onClick={() => router.push("/evals")}>
          {t("evalsTab.viewDashboard")}
        </button>
      </div>
      {runsLoading ? (
        <div style={s.tiles}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      ) : (
        <div style={s.tiles}>
          <MetricCard
            label={t("dashboard.metrics.recall")}
            value={latest ? pct(latest.recall) : NO_VALUE}
            suffix={latest ? "%" : undefined}
            color="var(--accent)"
            delta={deltaPts(latest?.recall, prev?.recall)}
          />
          <MetricCard
            label={t("dashboard.metrics.precision")}
            value={latest ? pct(latest.precision) : NO_VALUE}
            suffix={latest ? "%" : undefined}
            color="var(--ok)"
            delta={deltaPts(latest?.precision, prev?.precision)}
          />
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            value={latest ? pct(latest.citation_accuracy) : NO_VALUE}
            suffix={latest ? "%" : undefined}
            color="var(--warn)"
            delta={deltaPts(latest?.citation_accuracy, prev?.citation_accuracy)}
          />
          <MetricCard
            label={t("evalsTab.traces")}
            value={latest ? `${latest.passed}/${latest.total}` : NO_VALUE}
          />
        </div>
      )}

      {/* ---- metric trend across all runs ---- */}
      {runs && runs.length >= 2 && (
        <div style={s.panel}>
          <div style={s.header}>
            <h2 style={s.h2}>{t("dashboard.metricTrend")}</h2>
          </div>
          <TrendChart batches={runs} />
        </div>
      )}

      {/* ---- eval cases ---- */}
      <div style={s.panel}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
          {cases && cases.length > 0 && (
            <Badge color={passing === cases.length ? "var(--ok)" : "var(--warn)"}>
              {t("evalsTab.passingSummary", { passed: passing, total: cases.length })}
            </Badge>
          )}
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={runAll.isPending || !cases || cases.length === 0}
            onClick={onRunAll}
          >
            {runAll.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditor({ existing: null })}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
        {casesLoading ? (
          <Skeleton height={120} />
        ) : !cases || cases.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} body={t("evalsTab.noCasesRun")} />
        ) : (
          <div style={s.list}>
            {cases.map((c) => {
              const last = c.last_run;
              const dot =
                last == null
                  ? "var(--text-muted)"
                  : last.pass
                    ? "var(--ok)"
                    : "var(--crit)";
              return (
                <div key={c.id} style={s.caseRow} data-testid="eval-case-row">
                  <span style={s.statusDot(dot)} />
                  <div style={s.caseMain}>
                    <div style={s.caseName}>{c.name}</div>
                    <div style={s.caseMeta}>
                      {c.expectation
                        ? `${c.expectation.file}:${c.expectation.start_line}`
                        : t("evalsTab.invalidExpectation")}
                      {" · "}
                      {last
                        ? `${last.pass ? t("evalsTab.passed") : t("evalsTab.failed")} · ${fmtRanAt(last.ran_at)}`
                        : t("evalsTab.neverRun")}
                    </div>
                  </div>
                  <Badge
                    color={
                      c.expectation?.type === "must_not_flag"
                        ? "var(--text-secondary)"
                        : "var(--accent)"
                    }
                    mono
                  >
                    {c.expectation
                      ? c.expectation.type === "must_find"
                        ? t("evalsTab.mustFind")
                        : t("evalsTab.mustNotFlag")
                      : t("evalsTab.invalidExpectation")}
                  </Badge>
                  {runAll.isPending || (runOne.isPending && runOne.variables?.caseId === c.id) ? (
                    <RunningChip label={t("evalsTab.running")} />
                  ) : (
                    <IconBtn icon="Play" label={t("evalsTab.run")} onClick={() => onRunOne(c)} />
                  )}
                  <IconBtn
                    icon="Edit"
                    label={t("evalsTab.edit")}
                    onClick={() => setEditor({ existing: c })}
                  />
                  <IconBtn
                    icon="Trash"
                    label={t("evalsTab.delete")}
                    danger
                    onClick={() =>
                      del.mutate({ caseId: c.id }, { onSuccess: () => notify.info(t("evalsTab.deleted")) })
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- run history + compare ---- */}
      <div style={s.panel}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.runsHeading")}</h2>
          <Button
            kind="secondary"
            size="sm"
            icon="BarChart"
            disabled={pair.length !== 2}
            onClick={() => setCompareOpen(true)}
          >
            {t("evalsTab.compare")}
          </Button>
        </div>
        {runsLoading ? (
          <Skeleton height={120} />
        ) : !runs || runs.length === 0 ? (
          <p style={s.empty}>{t("evalsTab.noRuns")}</p>
        ) : (
          <div style={s.list}>
            {runs.map((b) => (
              <label key={b.batch_id} style={s.runRow(selected.includes(b.batch_id))}>
                <input
                  type="checkbox"
                  checked={selected.includes(b.batch_id)}
                  onChange={() => toggle(b.batch_id)}
                  aria-label={t("evalsTab.compareHint")}
                />
                <span style={s.runDate}>{fmtRanAt(b.ran_at)}</span>
                <Badge color="var(--accent)" mono>
                  {t("compare.version", { version: b.agent_version ?? "?" })}
                </Badge>
                <span style={s.runMetric("var(--accent)")}>{pct(b.recall)}%</span>
                <span style={s.runMetric("var(--ok)")}>{pct(b.precision)}%</span>
                <span style={s.runMetric("var(--warn)")}>{pct(b.citation_accuracy)}%</span>
                <span style={s.runPassed}>
                  {b.passed}/{b.total}
                </span>
                <span style={s.runCost}>{formatCostUsd(b.cost_usd)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {compareOpen && pair.length === 2 && (
        <CompareModal a={pair[0]!} b={pair[1]!} onClose={() => setCompareOpen(false)} />
      )}
      {editor && (
        <CaseEditorModal
          owner={{ kind: "agent", id: agent.id, name: agent.name }}
          existing={editor.existing}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

/** Two batches side by side: old → new with signed deltas per metric. */
function CompareModal({ a, b, onClose }: { a: EvalBatch; b: EvalBatch; onClose: () => void }) {
  const t = useTranslations("eval");
  const [oldB, newB] = orderPair(a, b);
  const label = (x: EvalBatch) =>
    x.agent_version != null ? t("compare.version", { version: x.agent_version }) : fmtRanAt(x.ran_at);
  return (
    <Modal
      width={640}
      title={t("compare.title", { a: label(oldB), b: label(newB) })}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <Button kind="secondary" size="sm" onClick={onClose}>
          {t("compare.close")}
        </Button>
      }
    >
      <div style={s.compareGrid}>
        {METRICS.map((m) => {
          const oldV = oldB[m.key];
          const newV = newB[m.key];
          const d = deltaPts(newV, oldV);
          return (
            <div key={m.key} style={s.compareCell}>
              <div style={s.compareLabel}>
                {m.key === "recall"
                  ? t("compare.recall")
                  : m.key === "precision"
                    ? t("compare.precision")
                    : t("compare.citation")}
              </div>
              <div style={s.compareValue}>
                <span style={s.compareOld}>{pct(oldV)}%</span>
                <span>→</span>
                <span style={{ color: m.color }}>{pct(newV)}%</span>
                {d != null && (
                  <span style={s.compareDelta(d > 0, d === 0)}>
                    {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)}pt
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div style={s.compareCell}>
          <div style={s.compareLabel}>{t("compare.passed")}</div>
          <div style={s.compareValue}>
            <span style={s.compareOld}>
              {oldB.passed}/{oldB.total}
            </span>
            <span>→</span>
            <span>
              {newB.passed}/{newB.total}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
