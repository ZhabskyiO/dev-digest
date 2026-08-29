"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { UseMutationResult } from "@tanstack/react-query";
import { Badge, Button } from "@devdigest/ui";
import type { CiExport, CiInstallation } from "@devdigest/shared";
import type { CiArchiveResult, CiExportVariables, ConfirmCiInstallationInput } from "@/lib/hooks/ci";
import { safeGithubUrl } from "@/lib/safeUrl";
import type { WizardAction, WizardState } from "../../reducer";

function cardStyle(selected: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    borderRadius: 8,
    padding: 16,
    background: "var(--bg-elevated)",
  };
}

/**
 * Step 4 — exactly two install methods, "open a PR" pre-selected (AC-25).
 * The Install/progress control itself lives in the shared modal footer
 * (`ExportWizard.tsx`) since it acts on whichever method is selected here;
 * this component only renders the method choice, the failure state (AC-32,
 * AC-57), the PR link on success, and the download-confirm step (AC-31).
 */
export function StepInstall({
  state,
  dispatch,
  exportMut,
  archiveMut,
  onConfirmDownload,
  confirmPending,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  exportMut: UseMutationResult<CiExport, Error, CiExportVariables>;
  archiveMut: UseMutationResult<CiArchiveResult, Error, CiExportVariables>;
  onConfirmDownload: () => void;
  confirmPending: boolean;
}) {
  const t = useTranslations("ci");
  const activeError = state.action === "open_pr" ? exportMut.error : archiveMut.error;
  const isYamlError = !!activeError && /yaml/i.test(activeError.message);
  const fileCount = state.previewFiles?.length ?? 0;
  const prUrl = safeGithubUrl(exportMut.data?.pr_url);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        role="radiogroup"
        aria-label={t("exportWizard.install")}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={state.action === "open_pr"}
          aria-label={t("exportWizard.method.openPr")}
          onClick={() => dispatch({ type: "SET_ACTION", action: "open_pr" })}
          style={cardStyle(state.action === "open_pr")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong>{t("exportWizard.installCardTitle")}</strong>
            <Badge bg="var(--accent-bg)" color="var(--accent-text)">
              {t("exportWizard.recommended")}
            </Badge>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0" }}>
            {t("exportWizard.installCardBody", { repo: state.repo, count: fileCount })}
          </p>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={state.action === "files"}
          aria-label={t("exportWizard.method.download")}
          onClick={() => dispatch({ type: "SET_ACTION", action: "files" })}
          style={cardStyle(state.action === "files")}
        >
          <strong>{t("exportWizard.method.download")}</strong>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0" }}>
            {t("exportWizard.method.downloadHint")}
          </p>
        </button>
      </div>

      {activeError && (
        <p role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
          {isYamlError
            ? t("exportWizard.workflowInvalidYaml")
            : t("exportWizard.installFailed", { repo: state.repo, reason: activeError.message })}
        </p>
      )}

      {state.action === "open_pr" && exportMut.isSuccess && prUrl && (
        <a href={prUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--accent)" }}>
          {prUrl}
        </a>
      )}

      {state.action === "files" && state.downloaded && (
        <Button kind="secondary" onClick={onConfirmDownload} disabled={confirmPending}>
          {t("exportWizard.downloadConfirm")}
        </Button>
      )}
    </div>
  );
}
