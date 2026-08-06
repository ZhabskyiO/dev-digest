/* /skills — Skills list. Master-detail via the URL: `?id=` picks the skill and
   `?tab=` picks the detail tab, mirroring /agents/:id. Never local state for
   either, so both survive a reload and a shared link. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import {
  useSkills,
  useSkillStatsSummary,
  useUpdateSkill,
} from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { DEFAULT_TAB, SkillDetail, TAB_KEYS } from "../SkillDetail";
import { AddSkillDrawer } from "./_components/AddSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

type DrawerTab = "file" | "url" | "community";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  // One request for the whole rail instead of a per-card fetch.
  const { data: summaries } = useSkillStatsSummary();
  const update = useUpdateSkill();
  const [drawerTab, setDrawerTab] = React.useState<DrawerTab | null>(null);
  const [search, setSearch] = React.useState("");

  const selectedId = searchParams.get("id");
  const list = filterSkills(skills ?? [], search);
  const selected = (skills ?? []).find((sk) => sk.id === selectedId) ?? null;

  const requestedTab = searchParams.get("tab") ?? "";
  const tab = TAB_KEYS.includes(requestedTab) ? requestedTab : DEFAULT_TAB;
  const statsFor = (id: string) => summaries?.find((r) => r.skill_id === id);

  /** Tab switch replaces the entry — flipping tabs shouldn't fill the history. */
  const setTab = (next: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    router.replace(`/skills?${sp.toString()}`);
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {drawerTab && <AddSkillDrawer initialTab={drawerTab} onClose={() => setDrawerTab(null)} />}
      <div style={s.shell}>
        {/* left: skills rail */}
        <div style={s.rail}>
          <div style={s.railHeader}>
            <div style={s.railTitleRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.fromFile"), icon: "File", onClick: () => setDrawerTab("file") },
                  { label: t("page.menu.fromUrl"), icon: "Link", onClick: () => setDrawerTab("url") },
                  { label: t("page.menu.community"), icon: "Users", onClick: () => setDrawerTab("community") },
                ]}
              />
            </div>
            <div style={s.search}>
              <Icon.Search size={13} style={s.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          <div style={s.railList}>
            {isLoading && (
              <div style={s.railSkeletons}>
                <Skeleton height={86} />
                <Skeleton height={86} />
                <Skeleton height={86} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && list.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setDrawerTab("file")}
              />
            )}
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === selectedId}
                stats={statsFor(sk.id)}
                onClick={() => router.push(`/skills?id=${sk.id}&tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* right: detail pane — config / preview / stats / versions */}
        <div style={s.detail}>
          {selected ? (
            <SkillDetail skill={selected} tab={tab} onTab={setTab} />
          ) : (
            <div style={s.selectPrompt}>
              <Icon.Sparkles size={28} style={{ color: "var(--text-muted)" }} />
              <div style={s.selectPromptTitle}>{t("page.selectPrompt.title")}</div>
              <div style={s.selectPromptBody}>{t("page.selectPrompt.body")}</div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
