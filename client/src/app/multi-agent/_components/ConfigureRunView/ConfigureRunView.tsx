/* ConfigureRunView — the /multi-agent Configure-run page (T16). Two steps:
   pick one of the ACTIVE repository's pull requests (AC-11), then pick which
   workspace agents to fan out over it via the shared `AgentPicker`
   (`variant: "full"`). Until a PR is selected, the agent list is replaced by
   a placeholder and the run action is disabled (AC-1) — `AgentPicker` is not
   rendered at all in that state, so its own submit button can't exist yet;
   this view renders its OWN (disabled) run control for that state instead,
   keeping exactly one submit control on screen at any time (never both). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, SearchableSelect } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { AgentPicker } from "@/components/multi-agent/AgentPicker";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgentEstimates, useAgents, usePulls, useStartMultiAgentRun } from "@/lib/hooks";
import { s } from "./styles";

export function ConfigureRunView() {
  const t = useTranslations("runs");
  // `page.configure.*` (this feature's own catalogue) has no dedicated step-2
  // heading key for the agents-to-run section — that string lives in
  // `settings.json`'s auto-reviews section (`autoReviews.agentsToRun`), added
  // for an unrelated toggle. Reusing it here avoids a hardcoded string
  // without adding a new key to `runs.json`, which this task does not own.
  const tSettings = useTranslations("settings");
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const { data: pulls } = usePulls(activeRepo?.id);
  const { data: agents } = useAgents();
  const [prNumber, setPrNumber] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);

  const prList = pulls ?? [];
  const pr = prList.find((p) => String(p.number) === prNumber) ?? null;
  const prId = pr?.id ?? null;

  const { data: estimates } = useAgentEstimates(prId);
  const startRun = useStartMultiAgentRun();

  // Picking a different PR invalidates the previous selection — the checked
  // agents were chosen against a different PR's estimates/summaries. This
  // lives in the select's own change handler (an event), not an effect.
  const onSelectPr = (value: string) => {
    setPrNumber(value);
    setSelected([]);
  };

  const onSubmit = () => {
    if (!pr?.id || !activeRepo) return;
    startRun.mutate(
      { prId: pr.id, agent_ids: selected },
      {
        onSuccess: () => {
          router.push(`/repos/${activeRepo.id}/pulls/${pr.number}/multi-agent`);
        },
      },
    );
  };

  const options = prList.map((p) => ({
    value: String(p.number),
    label: t("page.prItem", { number: p.number, title: p.title }),
  }));

  const crumb = [{ label: t("page.crumb") }];

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div>
          <h1 style={s.title}>{t("page.configure.title")}</h1>
          <p style={s.subtitle}>{t("page.subtitle")}</p>
        </div>

        <div>
          <div style={s.step}>
            <span style={s.stepBadge(true)}>1</span>
            <span style={s.stepLabel}>{t("page.selectPr")}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <SearchableSelect
              value={prNumber}
              onChange={onSelectPr}
              options={options}
              placeholder={t("page.configure.pickPr")}
              mono={false}
            />
          </div>
        </div>

        <div>
          <div style={s.step}>
            <span style={s.stepBadge(pr != null)}>2</span>
            <span style={s.stepLabel}>{tSettings("autoReviews.agentsToRun")}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            {pr == null ? (
              <div style={s.placeholder}>
                <EmptyState icon="Users" title={t("page.configure.pickPrPlaceholder")} />
              </div>
            ) : (
              <AgentPicker
                agents={agents ?? []}
                estimates={estimates}
                selected={selected}
                onChange={setSelected}
                variant="full"
                onSubmit={onSubmit}
                submitting={startRun.isPending}
              />
            )}
          </div>
        </div>

        {pr == null && (
          <div style={s.footer}>
            <Button kind="primary" icon="Users" disabled>
              {t("page.configure.submit", { count: selected.length })}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
