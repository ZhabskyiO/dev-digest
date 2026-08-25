/* CaseEditorModal — SHARED create/edit modal for one eval case (used by the
   AgentEditor Evals tab and by FindingCard's "Turn into eval case", which
   opens it PREFILLED via GET /findings/:id/eval-case-seed). Design mock:
   left = Name + Input (Diff | PR meta tabs, diff with syntax-coloured
   preview ↔ edit toggle); right = Expected output as a dark JSON panel with a
   live valid-JSON badge and a "+ Finding skeleton" helper; footer = Run-on-save
   toggle · Cancel · Run case · Save. "Run case" (and run-on-save) execute just
   this case (scope:'case' server-side) and show the expected/got banner. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Modal, SelectInput, TextInput, Tabs, Toggle } from "@devdigest/ui";
import type { EvalBatchResult, EvalCaseSeed, EvalCaseSummary, EvalExpectation as Expectation } from "@devdigest/shared";
import { EvalExpectation } from "@devdigest/shared";
import {
  useCreateEvalCase,
  useRunEvalCase,
  useUpdateEvalCase,
} from "../../lib/hooks/evals";
import { notify } from "../../lib/toast";
import { formatCostUsd } from "../../lib/format";
import { s, diffLineStyle } from "./styles";

const SKELETON: Expectation = {
  type: "must_find",
  file: "src/example.ts",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "security",
  title: "What the agent must find here",
};

function rangesOverlap(aS: number, aE: number, bS: number, bE: number): boolean {
  return Math.min(aS, aE) <= Math.max(bS, bE) && Math.min(bS, bE) <= Math.max(aS, aE);
}

export function CaseEditorModal({
  owner,
  existing,
  seed = null,
  onClose,
}: {
  /** The set this case belongs to — an agent's or a skill's. */
  owner: { kind: "agent" | "skill"; id: string; name: string };
  /** null = create a new case for this agent. */
  existing: EvalCaseSummary | null;
  /** Prefill from a decided finding (FindingCard → "Turn into eval case"). */
  seed?: EvalCaseSeed | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase(owner);
  const update = useUpdateEvalCase(owner);
  const runOne = useRunEvalCase(owner);

  const meta = (existing?.meta ?? null) as { pr_meta?: { title?: string; body?: string } } | null;
  const [savedId, setSavedId] = React.useState<string | null>(existing?.id ?? null);
  const [name, setName] = React.useState(existing?.name ?? seed?.name ?? "");
  const [diff, setDiff] = React.useState(existing?.input_diff ?? seed?.input_diff ?? "");
  const [prTitle, setPrTitle] = React.useState(meta?.pr_meta?.title ?? seed?.pr_meta.title ?? "");
  const [prBody, setPrBody] = React.useState(meta?.pr_meta?.body ?? seed?.pr_meta.body ?? "");
  const [tab, setTab] = React.useState("diff");
  const [diffEditing, setDiffEditing] = React.useState(!(existing?.input_diff ?? seed?.input_diff));
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [expectedJson, setExpectedJson] = React.useState(() =>
    JSON.stringify(existing?.expectation ?? seed?.expectation ?? SKELETON, null, 2),
  );
  const [lastRun, setLastRun] = React.useState<EvalBatchResult | null>(null);

  const parsed = React.useMemo(() => {
    try {
      return EvalExpectation.safeParse(JSON.parse(expectedJson));
    } catch {
      return { success: false as const, error: null };
    }
  }, [expectedJson]);

  /** Structured fields patch the SAME JSON the panel edits — one source of truth. */
  const patchExpectation = (patch: Partial<Expectation>) => {
    try {
      const obj = JSON.parse(expectedJson) as Record<string, unknown>;
      setExpectedJson(JSON.stringify({ ...obj, ...patch }, null, 2));
    } catch {
      setExpectedJson(JSON.stringify({ ...SKELETON, ...patch }, null, 2));
    }
  };
  const exp = parsed.success ? parsed.data : null;

  const valid = parsed.success && name.trim().length > 0 && diff.trim().length > 0;
  const saving = create.isPending || update.isPending;

  const doRun = (caseId: string) =>
    runOne.mutate(
      { caseId },
      {
        onSuccess: (d) => setLastRun(d),
        onError: (e) => notify.error(e instanceof Error ? e.message : String(e)),
      },
    );

  const buildPayload = (expected: Expectation) => ({
    name,
    input_diff: diff,
    expected_output: expected,
    pr_meta: { title: prTitle, body: prBody },
    ...(seed && !savedId ? { source_finding_id: seed.expectation.source_finding_id ?? null } : {}),
  });

  /** Run case — ALWAYS persists the current form state first (create or
   *  update), so what the editor shows is what gets scored. Running the stored
   *  version while unsaved edits sit in the form silently scores the old
   *  expectation — a repeat source of "why is this still green?". */
  const onRunClick = () => {
    if (!parsed.success || !valid) return;
    const payload = buildPayload(parsed.data);
    if (savedId) {
      update.mutate({ caseId: savedId, patch: payload }, { onSuccess: () => doRun(savedId) });
    } else {
      create.mutate(payload, {
        onSuccess: (created) => {
          notify.success(t("caseEditor.saved", { name }));
          setSavedId(created.id);
          doRun(created.id);
        },
      });
    }
  };

  const onSave = () => {
    if (!parsed.success) return;
    const payload = buildPayload(parsed.data);
    const saved = () => notify.success(t("caseEditor.saved", { name }));
    if (savedId) {
      update.mutate(
        { caseId: savedId, patch: payload },
        {
          onSuccess: () => {
            saved();
            if (runOnSave) doRun(savedId);
            else onClose();
          },
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: (created) => {
          saved();
          setSavedId(created.id);
          if (runOnSave) doRun(created.id);
          else onClose();
        },
      });
    }
  };

  // expected/got banner: matched count against the saved expectation
  const banner = React.useMemo(() => {
    const trace = lastRun?.result.per_trace[0];
    if (!lastRun || !trace || !parsed.success) return null;
    const exp = parsed.data;
    const actual = (trace.actual ?? []) as { file: string; start_line: number; end_line: number }[];
    const got = actual.filter(
      (f) => f.file === exp.file && rangesOverlap(exp.start_line, exp.end_line, f.start_line, f.end_line),
    ).length;
    return {
      pass: trace.pass,
      expected: exp.type === "must_find" ? 1 : 0,
      got,
      duration: (lastRun.result.duration_ms / 1000).toFixed(1),
      cost: formatCostUsd(lastRun.result.cost_usd),
    };
  }, [lastRun, parsed]);

  const diffLines = React.useMemo(() => diff.split("\n"), [diff]);

  return (
    <Modal
      width={1000}
      title={existing ? t("caseEditor.caseTitle", { name: existing.name }) : t("caseEditor.newCase")}
      subtitle={
        seed
          ? t(seed.decision === "accepted" ? "caseEditor.seededAccepted" : "caseEditor.seededDismissed")
          : t("caseEditor.subtitle", { agent: owner.name })
      }
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.runOnSave}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={18} />
            {t("caseEditor.runOnSave")}
          </label>
          <div style={s.footerActions}>
            <Button kind="secondary" size="sm" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={!valid || runOne.isPending || saving}
              onClick={onRunClick}
            >
              {runOne.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button kind="primary" size="sm" icon="Check" disabled={!valid || saving} onClick={onSave}>
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      {seed && (
        <div style={s.seedBanner(seed.expectation.type === "must_find")} data-testid="seed-banner">
          <div style={s.seedKind}>
            {t(seed.expectation.type === "must_find" ? "caseEditor.positiveCase" : "caseEditor.negativeCase")}
          </div>
          {t(
            seed.expectation.type === "must_find" ? "caseEditor.mustFindAt" : "caseEditor.mustNotFlagAt",
            {
              title: seed.expectation.title ?? "",
              file: seed.expectation.file,
              line: seed.expectation.start_line,
            },
          )}
        </div>
      )}
      <div style={s.cols}>
        {/* ---- left: name + input ---- */}
        <div style={s.col}>
          <div style={s.fieldLabel}>
            {t("caseEditor.nameLabel")} <span style={s.required}>*</span>
          </div>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} mono />

          <div style={s.inputHeader}>
            <span style={s.fieldLabel}>{t("caseEditor.inputLabel")}</span>
            {tab === "diff" && (
              <button type="button" style={s.previewToggle} onClick={() => setDiffEditing((e) => !e)}>
                {diffEditing ? t("caseEditor.preview") : t("caseEditor.editDiff")}
              </button>
            )}
          </div>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "meta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "diff" ? (
            diffEditing ? (
              <textarea
                data-testid="diff-editor"
                style={s.codeArea}
                rows={16}
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
                placeholder={t("caseEditor.diffPlaceholder")}
                spellCheck={false}
              />
            ) : (
              <pre data-testid="diff-preview" style={s.diffPre}>
                {diffLines.map((line, i) => (
                  <div key={i} style={diffLineStyle(line)}>
                    {line || " "}
                  </div>
                ))}
              </pre>
            )
          ) : (
            <div style={s.metaFields}>
              <div style={s.fieldLabel}>{t("caseEditor.titleLabel")}</div>
              <TextInput value={prTitle} onChange={setPrTitle} placeholder={t("caseEditor.titlePlaceholder")} />
              <div style={s.fieldLabel}>{t("caseEditor.bodyLabel")}</div>
              <textarea
                style={s.codeArea}
                rows={10}
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                placeholder={t("caseEditor.bodyPlaceholder")}
              />
            </div>
          )}
        </div>

        {/* ---- right: expected output ---- */}
        <div style={s.col}>
          <div style={s.structRow}>
            <div style={s.structType}>
              <SelectInput
                value={exp?.type ?? "must_find"}
                onChange={(v: string) => patchExpectation({ type: v as Expectation["type"] })}
                options={[
                  { value: "must_find", label: t("evalsTab.mustFind") },
                  { value: "must_not_flag", label: t("evalsTab.mustNotFlag") },
                ]}
              />
            </div>
            <div style={s.structFile}>
              <TextInput
                value={exp?.file ?? ""}
                onChange={(v) => patchExpectation({ file: v })}
                placeholder="src/file.ts"
                mono
              />
            </div>
            <input
              aria-label={t("caseEditor.startLine")}
              type="number"
              min={1}
              style={s.lineInput}
              value={exp?.start_line ?? 1}
              onChange={(e) => patchExpectation({ start_line: Number(e.target.value) || 1 })}
            />
            <span style={s.lineDash}>–</span>
            <input
              aria-label={t("caseEditor.endLine")}
              type="number"
              min={1}
              style={s.lineInput}
              value={exp?.end_line ?? 1}
              onChange={(e) => patchExpectation({ end_line: Number(e.target.value) || 1 })}
            />
          </div>
          <div style={s.expectedHeader}>
            <span style={s.fieldLabel}>{t("caseEditor.expectedOutput")}</span>
            <Badge color={parsed.success ? "var(--ok)" : "var(--crit)"}>
              {parsed.success ? `✓ ${t("caseEditor.validJson")}` : t("caseEditor.invalidJson")}
            </Badge>
            <div style={s.spacer} />
            <Button
              kind="ghost"
              size="sm"
              icon="Plus"
              onClick={() => setExpectedJson(JSON.stringify(SKELETON, null, 2))}
            >
              {t("caseEditor.findingSkeleton")}
            </Button>
          </div>
          <textarea
            data-testid="expected-json"
            style={{ ...s.codeArea, flex: 1, minHeight: 320 }}
            value={expectedJson}
            onChange={(e) => setExpectedJson(e.target.value)}
            spellCheck={false}
          />
          <div style={{ ...s.fieldLabel, marginTop: 14 }}>{t("caseEditor.actualOutput")}</div>
          {lastRun ? (
            <pre style={s.actualPre} data-testid="actual-output">
              {JSON.stringify(lastRun.result.per_trace[0]?.actual ?? [], null, 2)}
            </pre>
          ) : (
            <div style={s.actualEmpty}>{t("caseEditor.neverRun")}</div>
          )}
          {banner && (
            <div style={s.banner(banner.pass)} data-testid="case-run-banner">
              <Icon.CheckCircle size={15} style={{ flexShrink: 0 }} />
              <span>
                <strong>{banner.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}</strong>
                {" · "}
                {t("caseEditor.gotSummary", {
                  expected: banner.expected,
                  got: banner.got,
                  duration: banner.duration,
                  cost: banner.cost,
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
