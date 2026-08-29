/* AgentEditor — agent config + skills editor (Config/Skills/Context/Evals/Stats/Versions). Tab state lives in ?tab= for forward-compatibility. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { StatsTab } from "./_components/StatsTab";
import { EvalsTab } from "./_components/EvalsTab";
import { CiTab } from "./_components/CiTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "skills" ? (
          <SkillsTab agent={agent} />
        ) : tab === "context" ? (
          <ContextTab agent={agent} />
        ) : tab === "evals" ? (
          <EvalsTab agent={agent} />
        ) : tab === "stats" ? (
          <StatsTab agent={agent} />
        ) : tab === "ci" ? (
          <CiTab agent={agent} />
        ) : tab === "versions" ? (
          <VersionsTab agent={agent} />
        ) : (
          <ConfigTab agent={agent} />
        )}
      </div>
    </div>
  );
}
