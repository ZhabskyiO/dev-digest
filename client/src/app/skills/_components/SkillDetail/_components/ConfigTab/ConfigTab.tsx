/* ConfigTab — edit a skill's name, description, type, enabled flag and body.
   Replaces the old SkillPreview edit mode; the read-only render moved to
   PreviewTab. Only a body change bumps the version server-side, which is why
   the "what changed" note is hinted as body-only. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { approxTokens } from "../../../../../../lib/tokens";
import { useToast } from "../../../../../../lib/toast";
import { needsVetting } from "../../../SkillCard/helpers";
import { s } from "./styles";

const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const toast = useToast();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [changeNote, setChangeNote] = React.useState("");

  // Reset when the selection changes, or when a save lands and the server
  // echoes back a bumped version.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setChangeNote("");
  }, [skill.id, skill.version, skill.name, skill.description, skill.type, skill.body]);

  const bodyChanged = body !== skill.body;

  const save = () => {
    update.mutate(
      {
        id: skill.id,
        patch: {
          name: name.trim(),
          description,
          type,
          body,
          // Sending it unconditionally is harmless — the server drops a label
          // when no snapshot is written — but keeping it conditional documents
          // the intent at the call site.
          ...(bodyChanged && changeNote.trim() ? { version_label: changeNote.trim() } : {}),
        },
      },
      { onSuccess: (data) => toast.success(t("config.savedToast", { version: data.version })) },
    );
  };

  const showUntrustedNotice = skill.source !== "manual" && !skill.enabled;

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.h2}>{t("config.heading")}</h2>
        <div style={s.enabledBox}>
          <span>{t("config.enabled")}</span>
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
          />
        </div>
      </div>

      {showUntrustedNotice && (
        <div style={s.notice}>
          <Icon.Shield size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <FormField label={t("config.nameLabel")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("config.descriptionLabel")} hint={t("edit.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("config.typeLabel")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES}
        />
      </FormField>

      <FormField label={t("config.bodyLabel")} required>
        <div style={s.editor}>
          <div style={s.editorHead}>
            <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
            <span className="mono" style={s.editorFile}>{`${skill.name}.md`}</span>
            {bodyChanged && <Badge color="var(--text-muted)">{t("config.unsaved")}</Badge>}
            <span className="mono tnum" style={s.tokenCount}>
              {t("config.tokenCount", { count: approxTokens(body).toLocaleString("en-US") })}
            </span>
          </div>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            ariaLabel={t("config.bodyLabel")}
            minHeight={320}
          />
        </div>
      </FormField>

      <FormField
        label={t("config.changeLabel")}
        hint={t("config.changeHint")}
      >
        <TextInput
          value={changeNote}
          onChange={setChangeNote}
          placeholder={t("config.changePlaceholder")}
        />
      </FormField>

      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={update.isPending || !name.trim() || !body.trim()}
        >
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {needsVetting(skill) && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        )}
      </div>
    </div>
  );
}
