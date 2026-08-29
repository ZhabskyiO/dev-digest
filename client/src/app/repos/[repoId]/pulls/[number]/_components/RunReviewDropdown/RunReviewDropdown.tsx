/* RunReviewDropdown — the "Run Review" trigger on a PR's detail header opens
   a quick picker: the shared `AgentPicker` (`variant: "compact"`), one
   checkbox row per WORKSPACE agent with its duration estimate, a "Clear"
   action, and a primary run action labelled with the checked count. Submit
   goes through the SAME `useStartMultiAgentRun()` mutation the full
   Configure page uses (AC-15) — there is no separate "run all" / "run one
   agent immediately" path anymore (AC-14). A merged/closed PR still allows
   the run, just with a non-blocking warning shown above the picker
   (AC-16). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { AgentPicker } from "@/components/multi-agent/AgentPicker";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useAgentEstimates, useStartMultiAgentRun } from "../../../../../../../lib/hooks/multi-agent";
import { DROPDOWN_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates(prId);
  const start = useStartMultiAgentRun();

  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Seed the checked set to every ENABLED agent the first time the
  // workspace's agent list arrives, and never again — a later background
  // refetch (e.g. another tab enabling an agent) must not clobber a
  // selection the user is actively editing.
  const seededRef = React.useRef(false);

  const all = agents ?? [];

  React.useEffect(() => {
    if (seededRef.current || agents == null) return;
    seededRef.current = true;
    setSelected(agents.filter((a) => a.enabled).map((a) => a.id));
  }, [agents]);

  // `Button` (`@devdigest/ui`) doesn't declare `ref` on its own props type,
  // so the trigger's focus target is recovered via a ref on its native
  // wrapping `<span>` instead of forwarding a ref into `Button` itself.
  const triggerWrapRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerWrapRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSubmit = () => {
    if (selected.length === 0) return;
    onRunStart?.();
    start.mutate(
      { prId, agent_ids: selected },
      {
        onSuccess: (res) => {
          onRunsStarted?.(res.runs.map((r) => r.run_id));
          setOpen(false);
        },
        onSettled: () => {
          onRunSettled?.();
        },
      },
    );
  };

  return (
    <div ref={containerRef} style={s.root}>
      <span
        ref={triggerWrapRef}
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={start.isPending}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((o) => !o)}
        >
          {start.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={s.panel(DROPDOWN_WIDTH)}>
          {warnMerged && (
            <div style={s.warning}>
              <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
              <span>{t("runReview.mergedWarning")}</span>
            </div>
          )}
          <AgentPicker
            agents={all}
            estimates={estimates}
            selected={selected}
            onChange={setSelected}
            variant="compact"
            onSubmit={handleSubmit}
            submitting={start.isPending}
          />
          <button
            type="button"
            style={s.configureLink}
            onClick={() => {
              setOpen(false);
              router.push("/multi-agent");
            }}
          >
            {t("runReview.picker.configureLink")}
          </button>
        </div>
      )}
    </div>
  );
}
