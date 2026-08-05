/* SkillPreview — right-hand pane for the selected skill. Renders the body via
   <Markdown>, an Edit toggle that swaps to editable fields + Save/Cancel (via
   useUpdateSkill), the untrusted-source notice, and the version badge. The
   body editor shows a live ~token counter (approxTokens) in its FormField's
   right slot while editing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, TextInput, Textarea, Toggle, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { approxTokens, DEFAULT_TOKEN_BUDGET } from "../../../../../../lib/tokens";
import { needsVetting, typeColor } from "../../../SkillCard/helpers";
import { s } from "./styles";

export function SkillPreview({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [editing, setEditing] = React.useState(false);
  const [draftDescription, setDraftDescription] = React.useState(skill.description);
  const [draftBody, setDraftBody] = React.useState(skill.body);

  // Reset local edit state whenever the selected skill changes (or a save
  // lands and the server echoes back the new version).
  React.useEffect(() => {
    setEditing(false);
    setDraftDescription(skill.description);
    setDraftBody(skill.body);
  }, [skill.id, skill.version]);

  const startEdit = () => {
    setDraftDescription(skill.description);
    setDraftBody(skill.body);
    setEditing(true);
  };

  const save = () => {
    update.mutate(
      { id: skill.id, patch: { description: draftDescription, body: draftBody } },
      { onSuccess: () => setEditing(false) },
    );
  };

  const showUntrustedNotice = skill.source !== "manual" && !skill.enabled;

  return (
    <div style={s.page}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={17} />
        </div>
        <h1 style={s.name}>{skill.name}</h1>
        <Toggle on={skill.enabled} onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })} />
      </div>
      <div style={s.metaRow}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: typeColor(skill.type) }}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <Badge color="var(--text-secondary)">{t(`listItem.source.${skill.source}`)}</Badge>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        {needsVetting(skill) && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        )}
      </div>

      {showUntrustedNotice && (
        <div style={s.notice}>
          <Icon.Shield size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      {editing ? (
        <>
          <FormField label={t("edit.descriptionLabel")} hint={t("edit.descriptionHint")}>
            <TextInput value={draftDescription} onChange={setDraftDescription} />
          </FormField>
          <FormField
            label={t("preview.bodyLabel")}
            hint={t("preview.bodyHint")}
            right={
              <span style={s.tokenCount}>
                {t("preview.tokenCount", {
                  count: approxTokens(draftBody).toLocaleString("en-US"),
                  budget: DEFAULT_TOKEN_BUDGET.toLocaleString("en-US"),
                })}
              </span>
            }
          >
            <Textarea value={draftBody} onChange={setDraftBody} rows={16} mono />
          </FormField>
          <div style={s.editActions}>
            <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
              {t("preview.save")}
            </Button>
            <Button kind="ghost" onClick={() => setEditing(false)} disabled={update.isPending}>
              {t("preview.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={s.description}>{skill.description}</div>
          <div style={s.sectionHeader}>
            <span style={s.sectionLabel}>{t("preview.bodyLabel")}</span>
            <Button kind="secondary" size="sm" icon="Edit" onClick={startEdit}>
              {t("preview.edit")}
            </Button>
          </div>
          <div style={s.body}>
            <Markdown>{skill.body}</Markdown>
          </div>
        </>
      )}
    </div>
  );
}
