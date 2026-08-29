"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useCiArchive, useCiExport, useConfirmCiInstallation } from "@/lib/hooks/ci";
import { StepConfigure } from "./_components/StepConfigure";
import { StepInstall } from "./_components/StepInstall";
import { StepPreview } from "./_components/StepPreview";
import { StepTarget } from "./_components/StepTarget";
import { downloadArchive } from "./download";
import { canContinue, initialWizardState, wizardReducer } from "./reducer";
import { s } from "./styles";

const STEP_COUNT = 4;

/**
 * Traps focus inside the modal, restores it to whatever triggered `open` on
 * close, and closes on Escape. `Modal` (vendored, not owned by this task)
 * renders `role="dialog"` but has no such a11y wiring of its own, so the
 * wizard supplies it here rather than editing the vendored primitive.
 */
function useModalA11y(open: boolean, onClose: () => void) {
  // `onClose` lives in a ref, not the effect's dependency array: CiTab passes
  // a brand-new inline `() => setWizardOpen(false)` on every render, and any
  // CiTab re-render while the wizard is open (a poll tick, a mutation
  // settling) would otherwise tear down and re-run this effect — re-seeding
  // `trigger` from whatever currently has focus (the field being typed in)
  // and yanking focus back to it via the fresh focus-first-control timer.
  // Depending on `[open]` alone means this effect only runs when the modal
  // actually opens or closes, never on an unrelated parent re-render.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement as HTMLElement | null;
    const getFocusable = (): HTMLElement[] => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return [];
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };
    // Focus after the dialog has actually painted (mirrors CommandPalette's
    // own post-paint focus timing — `vendor/ui/command-palette`).
    const focusTimer = setTimeout(() => getFocusable()[0]?.focus(), 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = getFocusable();
      if (list.length === 0) return;
      const first = list[0] as HTMLElement;
      const last = list[list.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      // Only restore focus to the trigger when the modal is actually
      // closing (this cleanup runs because `open` flipped to false), not
      // when it's a no-op re-run from an `open` toggle that never happens —
      // `open` is the sole dependency, so this cleanup fires exactly once
      // per real open→close transition.
      trigger?.focus();
    };
  }, [open]);
}

/** The four-step "Export to CI" wizard (Target → Preview → Configure →
 *  Install). Standalone: takes only `{ agent, open, onClose }` — a later
 *  task (T16) mounts it from the agent's CI tab. */
export function ExportWizard({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const t = useTranslations("ci");
  const [state, dispatch] = React.useReducer(wizardReducer, initialWizardState);
  const exportMut = useCiExport();
  const archiveMut = useCiArchive();
  const confirmMut = useConfirmCiInstallation();
  useModalA11y(open, onClose);

  // A fresh wizard every time it's (re)opened — never resume a stale draft
  // from a previous export attempt.
  React.useEffect(() => {
    if (open) dispatch({ type: "RESET" });
  }, [open]);

  if (!open) return null;

  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.preview"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.install"),
  ];
  const installPending = state.action === "open_pr" ? exportMut.isPending : archiveMut.isPending;

  const handleInstall = () => {
    const base = {
      agentId: agent.id,
      repo: state.repo,
      target: "gha" as const,
      post_as: state.postAs,
      triggers: state.triggers,
      workflow_override: state.workflowOverride ?? undefined,
    };
    if (state.action === "open_pr") {
      exportMut.mutate({ ...base, action: "open_pr" });
    } else {
      archiveMut.mutate(
        { ...base, action: "files" },
        {
          onSuccess: (result) => {
            downloadArchive(result);
            dispatch({ type: "SET_DOWNLOADED", downloaded: true });
          },
        },
      );
    }
  };

  const handleConfirmDownload = () => {
    confirmMut.mutate(
      {
        agentId: agent.id,
        repo: state.repo,
        target: "gha",
        base: "main",
        post_as: state.postAs,
        triggers: state.triggers,
      },
      { onSuccess: onClose },
    );
  };

  const goNext = () => dispatch({ type: "GO_TO_STEP", step: state.step + 1 });
  const goBack = () => dispatch({ type: "GO_TO_STEP", step: state.step - 1 });

  return (
    <Modal
      width={860}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {state.step > 0 && (
            <Button kind="ghost" icon="ChevronLeft" onClick={goBack}>
              {t("exportWizard.back")}
            </Button>
          )}
          <div style={s.footerRight}>
            {state.step < STEP_COUNT - 1 ? (
              <Button kind="primary" iconRight="ArrowRight" disabled={!canContinue(state)} onClick={goNext}>
                {t("exportWizard.continue")}
              </Button>
            ) : (
              <Button kind="primary" icon="Check" disabled={installPending} onClick={handleInstall}>
                {installPending ? t("exportWizard.installing") : t("exportWizard.install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div
          role="group"
          style={s.stepIndicator}
          aria-label={t("exportWizard.stepIndicator", { current: state.step + 1, total: STEP_COUNT })}
        >
          <ExportWizardSteps step={state.step} labels={stepLabels} />
        </div>
        <div style={s.stepBody}>
          {state.step === 0 && <StepTarget state={state} dispatch={dispatch} />}
          {state.step === 1 && <StepPreview state={state} dispatch={dispatch} agentId={agent.id} />}
          {state.step === 2 && <StepConfigure state={state} dispatch={dispatch} />}
          {state.step === 3 && (
            <StepInstall
              state={state}
              dispatch={dispatch}
              exportMut={exportMut}
              archiveMut={archiveMut}
              onConfirmDownload={handleConfirmDownload}
              confirmPending={confirmMut.isPending}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
