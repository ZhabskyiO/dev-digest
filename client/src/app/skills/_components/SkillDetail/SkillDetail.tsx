/* SkillDetail — the right-hand pane of /skills. Header (name, type, version)
   plus four tabs, mirroring the /agents/:id editor. The active tab lives in the
   URL (`?tab=`), owned by SkillsListView, so it survives a reload and switching
   between skills. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { typeColor } from "../SkillCard/helpers";
import { TABS } from "./constants";
import { s } from "./styles";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";

export function SkillDetail({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: string;
  onTab: (tab: string) => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={16} />
        </div>
        <h1 className="mono" style={s.name}>
          {skill.name}
        </h1>
        <div style={s.headerMeta}>
          <Badge color={typeColor(skill.type)}>{t(`listItem.type.${skill.type}`)}</Badge>
          <Badge color="var(--text-secondary)" mono icon="History">
            {`v${skill.version}`}
          </Badge>
        </div>
      </div>

      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>

      <div style={s.body}>
        {tab === "preview" ? (
          <PreviewTab skill={skill} />
        ) : tab === "stats" ? (
          <StatsTab skill={skill} />
        ) : tab === "versions" ? (
          <VersionsTab skill={skill} />
        ) : (
          <ConfigTab skill={skill} />
        )}
      </div>
    </div>
  );
}
