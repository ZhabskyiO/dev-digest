/* /agents — Agents list (A2, L03). AgentCards + create. Selecting an agent
   navigates to the 5-tab editor at /agents/:id. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useAgents, useAgentStats, useUpdateAgent } from "../../../../lib/hooks/agents";
import { useAgentSkills } from "../../../../lib/hooks/skills";
import { AgentCard } from "../AgentCard";
import { CreateAgentModal } from "./_components/CreateAgentModal";
import { TEMPLATES } from "./constants";
import { filterAgents } from "./helpers";
import { s } from "./styles";

// Wraps AgentCard to fetch its own skill count + run stats (small N of
// per-id queries, deduped/cached by React Query — an accepted pattern for a
// grid this size).
function AgentGridItem({
  a,
  onClick,
  onToggle,
}: {
  a: Agent;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { data: links } = useAgentSkills(a.id);
  const { data: stats } = useAgentStats(a.id);
  return (
    <AgentCard ag={a} skillCount={links?.length} stats={stats} onClick={onClick} onToggle={onToggle} />
  );
}

export function AgentsListView() {
  const t = useTranslations("agents");
  const router = useRouter();
  const { data: agents, isLoading, isError, refetch } = useAgents();
  const update = useUpdateAgent();
  const [creating, setCreating] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const list = filterAgents(agents ?? [], search);

  return (
    <AppShell crumb={[{ label: t("list.breadcrumbLab") }, { label: t("list.breadcrumb") }]}>
      {creating && <CreateAgentModal onClose={() => setCreating(false)} />}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("list.title")}</h1>
            <p style={s.subtitle}>{t("list.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("list.addAgent")}
              </Button>
            }
            items={[
              { label: t("list.createFromScratch"), icon: "Edit", onClick: () => setCreating(true) },
              { divider: true },
              ...TEMPLATES.map((tp) => ({
                label: tp,
                icon: "Cpu" as const,
                muted: true,
                onClick: () => setCreating(true),
              })),
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {isError && <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Cpu"
            title={t("list.emptyTitle")}
            body={t("list.emptyBody")}
            cta={t("list.emptyCta")}
            onCta={() => setCreating(true)}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((a) => (
              <AgentGridItem
                key={a.id}
                a={a}
                onClick={() => router.push(`/agents/${a.id}?tab=config`)}
                onToggle={(enabled) => update.mutate({ id: a.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
