"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Textarea } from "@devdigest/ui";
import { useCiPreview } from "@/lib/hooks/ci";
import { previewTupleKey, type WizardAction, type WizardState } from "../../reducer";

/**
 * Step 2 — generates the bundle (zero side effects, T13's `ci-preview`) and
 * renders a selectable file list + the selected file's contents. Only the
 * file the SERVER marks `editable: true` renders in a textarea (AC-13,
 * AC-18) — never a hardcoded path. Fires the preview mutation once per
 * (repo, triggers, post_as) tuple (`state.previewKey` vs `previewTupleKey`),
 * not on every render.
 */
export function StepPreview({
  state,
  dispatch,
  agentId,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  agentId: string;
}) {
  const t = useTranslations("ci");
  const preview = useCiPreview();
  const tupleKey = previewTupleKey(state);

  // Shared by the auto-fetch effect below and the error state's manual
  // Retry control — both fetch the CURRENT tuple and tag the result with
  // ITS key, so the reducer's stale-response guard (`PREVIEW_SUCCESS`,
  // `reducer.ts`) can tell a late response for an abandoned tuple apart from
  // a legitimate one for the tuple the user is still looking at.
  const runPreview = React.useCallback(() => {
    preview.mutate(
      { agentId, repo: state.repo, triggers: state.triggers, post_as: state.postAs },
      { onSuccess: (data) => dispatch({ type: "PREVIEW_SUCCESS", files: data.files, key: tupleKey }) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tupleKey, agentId, state.repo, state.triggers, state.postAs]);

  React.useEffect(() => {
    if (state.previewKey === tupleKey) return;
    runPreview();
    // Only re-fires when the tuple (or what it was last fetched for) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tupleKey, state.previewKey]);

  const files = state.previewFiles ?? [];
  const selected = files.find((f) => f.path === state.selectedFilePath) ?? files[0] ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, minHeight: 300 }}>
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-muted)",
            marginBottom: 10,
            letterSpacing: "0.04em",
          }}
        >
          {t("exportWizard.filesToCreate")}
        </div>
        {preview.isPending && !state.previewFiles && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("exportWizard.generating")}</p>
        )}
        {preview.isError && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <p role="alert" style={{ fontSize: 13, color: "var(--crit)", margin: 0 }}>
              {t("exportWizard.previewFailed", {
                reason: preview.error instanceof Error ? preview.error.message : String(preview.error),
              })}
            </p>
            <Button kind="secondary" icon="RefreshCw" onClick={runPreview}>
              {t("exportWizard.retry")}
            </Button>
          </div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => dispatch({ type: "SELECT_FILE", path: f.path })}
                aria-pressed={f.path === selected?.path}
                className="mono"
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 12.5,
                  background: f.path === selected?.path ? "var(--accent-bg)" : "transparent",
                  color: f.path === selected?.path ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {selected && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="mono" style={{ fontSize: 13 }}>
                {selected.path}
              </span>
              {selected.editable && <Badge icon="Edit">{t("exportWizard.editable")}</Badge>}
            </div>
            {selected.editable ? (
              <Textarea
                value={state.workflowOverride ?? selected.contents}
                onChange={(v) => dispatch({ type: "SET_WORKFLOW_OVERRIDE", contents: v })}
                rows={16}
                mono
              />
            ) : (
              <pre
                className="mono"
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  maxHeight: 380,
                  overflow: "auto",
                }}
              >
                {selected.contents}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
