/* Skill EvalsTab — the SKILL's regression harness. Cases are owned by the
   skill (eval_cases.owner_kind = 'skill'); a run executes each case TWICE
   through a deterministic carrier agent — with only this skill injected, and
   without it — so every case shows the skill's measured lift
   ("With skill X% / Without skill Y%"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, IconBtn, Skeleton } from "@devdigest/ui";
import type { EvalCaseSummary, Skill } from "@devdigest/shared";
import { CaseEditorModal } from "@/components/eval-case-editor";
import {
  useDeleteEvalCase,
  useRunEvalCase,
  useRunSkillEvals,
  useSkillEvalCases,
} from "../../../../../../lib/hooks/evals";
import { notify } from "../../../../../../lib/toast";
import { fmtRanAt } from "./helpers";
import { s } from "./styles";


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

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("eval");
  const owner = React.useMemo(
    () => ({ kind: "skill" as const, id: skill.id, name: skill.name }),
    [skill.id, skill.name],
  );
  const { data: cases, isLoading } = useSkillEvalCases(skill.id);
  const runAll = useRunSkillEvals(skill.id);
  const runOne = useRunEvalCase(owner);
  const del = useDeleteEvalCase(owner);
  const [editor, setEditor] = React.useState<null | { existing: EvalCaseSummary | null }>(null);

  const passing = (cases ?? []).filter((c) => c.last_run?.pass === true).length;

  const onRunAll = () =>
    runAll.mutate(undefined, {
      onSuccess: (d) =>
        notify.success(t("evalsTab.runDone", { passed: d.batch.passed, total: d.batch.total })),
      onError: (e) =>
        notify.error(t("evalsTab.runFailed", { message: e instanceof Error ? e.message : String(e) })),
    });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        {cases && cases.length > 0 && (
          <>
            <Badge color={passing === cases.length ? "var(--ok)" : "var(--warn)"}>
              {t("evalsTab.passingSummary", { passed: passing, total: cases.length })}
            </Badge>
            <span style={s.count}>{t("dashboard.casesCount", { count: cases.length })}</span>
          </>
        )}
        <div style={s.spacer} />
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          disabled={runAll.isPending || !cases || cases.length === 0}
          onClick={onRunAll}
        >
          {runAll.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditor({ existing: null })}>
          {t("caseEditor.newCase")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton height={140} />
      ) : !cases || cases.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title={t("skillEvals.emptyTitle")}
          body={t("skillEvals.emptyBody")}
        />
      ) : (
        <div style={s.list}>
          {cases.map((c) => {
            const exp = c.expectation;
            const last = c.last_run;
            const dot =
              last == null ? "var(--text-muted)" : last.pass ? "var(--ok)" : "var(--crit)";
            const expected = exp?.type === "must_find" ? 1 : 0;
            return (
              <div key={c.id} style={s.row} data-testid="skill-eval-case-row">
                <span style={s.dot(dot)} />
                <div style={s.main}>
                  <div style={s.titleRow}>
                    <span style={s.name}>{c.name}</span>
                    <Badge color={exp?.type === "must_find" ? "var(--accent)" : "var(--ok)"} mono>
                      {exp
                        ? exp.type === "must_find"
                          ? t("evalsTab.mustFind")
                          : t("evalsTab.mustNotFlag")
                        : t("evalsTab.invalidExpectation")}
                    </Badge>
                  </div>
                  <div style={s.meta}>
                    {last
                      ? t("skillEvals.expectedGot", { expected, got: last.matched ?? 0 })
                      : t("evalsTab.neverRun")}
                    {last?.baseline_pass != null && (
                      <>
                        {" · "}
                        {t("skillEvals.withWithout", {
                          w: last.pass ? 100 : 0,
                          wo: last.baseline_pass ? 100 : 0,
                        })}
                      </>
                    )}
                    {last && <> · {fmtRanAt(last.ran_at)}</>}
                  </div>
                </div>
                {exp?.severity && (
                  <span style={s.sevChip}>
                    {exp.severity} · {exp.category}
                  </span>
                )}
                {runAll.isPending || (runOne.isPending && runOne.variables?.caseId === c.id) ? (
                  <RunningChip label={t("evalsTab.running")} />
                ) : (
                <IconBtn
                  icon="Play"
                  label={t("evalsTab.run")}
                  onClick={() =>
                    runOne.mutate(
                      { caseId: c.id },
                      {
                        onSuccess: (d) => {
                          const pass = d.result.per_trace[0]?.pass;
                          (pass ? notify.success : notify.error)(
                            t("evalsTab.caseRunResult", {
                              name: c.name,
                              status: pass ? t("evalsTab.passed") : t("evalsTab.failed"),
                            }),
                          );
                        },
                        onError: (e) => notify.error(e instanceof Error ? e.message : String(e)),
                      },
                    )
                  }
                />
                )}
                <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={() => setEditor({ existing: c })} />
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

      {editor && <CaseEditorModal owner={owner} existing={editor.existing} onClose={() => setEditor(null)} />}
    </div>
  );
}
