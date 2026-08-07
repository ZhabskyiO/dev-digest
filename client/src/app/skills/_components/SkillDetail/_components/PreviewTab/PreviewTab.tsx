/* PreviewTab — the skill body rendered, i.e. what the reviewing agent's prompt
   actually contains. The read-only half of the old SkillPreview. */
"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("previewTab.heading")}</h2>
      <p style={s.subtitle}>{t("previewTab.subtitle")}</p>
      <div style={s.card}>
        {skill.body.trim() ? (
          <Markdown>{skill.body}</Markdown>
        ) : (
          <span style={s.empty}>{t("previewTab.empty")}</span>
        )}
      </div>
    </div>
  );
}
