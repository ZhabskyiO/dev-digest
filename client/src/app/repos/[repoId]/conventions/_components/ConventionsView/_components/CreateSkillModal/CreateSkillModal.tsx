/* CreateSkillModal — folds the accepted conventions into one skill. Opens with
   a composed markdown body and metadata the user can rewrite; whatever is in
   the editor on save is exactly what gets persisted. Optionally appends the new
   skill to an agent's ordered skill list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionCandidateDetail, SkillType } from "@devdigest/shared";
import { useAgents } from "../../../../../../../../lib/hooks/agents";
import { useCreateSkillFromConventions } from "../../../../../../../../lib/hooks/conventions";
import { approxTokens } from "../../../../../../../../lib/tokens";
import { ApiError } from "../../../../../../../../lib/api";
import { defaultSkillName } from "../../helpers";
import { composeSkillBody } from "./helpers";
import { s } from "./styles";

const SKILL_TYPES: SkillType[] = ["convention", "rubric", "security", "custom"];
const NO_AGENT = "";

export interface CreateSkillModalProps {
  repoId: string;
  repoName: string;
  candidates: ConventionCandidateDetail[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateSkillModal({
  repoId,
  repoName,
  candidates,
  onClose,
  onCreated,
}: CreateSkillModalProps) {
  const t = useTranslations("conventions");
  const { data: agents } = useAgents();
  const create = useCreateSkillFromConventions(repoId);

  const initialName = defaultSkillName(repoName);
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(
    t("modal.defaultDescription", { count: candidates.length, repo: repoName }),
  );
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [agentId, setAgentId] = React.useState<string>(NO_AGENT);
  const [body, setBody] = React.useState(() =>
    composeSkillBody(initialName, repoName, candidates),
  );

  const save = () => {
    create.mutate(
      {
        candidate_ids: candidates.map((c) => c.id),
        name: name.trim(),
        description,
        body,
        type,
        enabled,
        agent_id: agentId === NO_AGENT ? null : agentId,
      },
      { onSuccess: onCreated },
    );
  };

  const agentOptions = [
    { value: NO_AGENT, label: t("modal.agentNone") },
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <Modal
      width={860}
      title={t("modal.title")}
      subtitle={<span className="mono">{name}</span>}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>
            <Icon.History size={13} />
            {t("modal.savedAs")}
          </span>
          <div style={s.footerActions}>
            <Button kind="ghost" onClick={onClose} disabled={create.isPending}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={save}
              disabled={create.isPending || !name.trim() || !body.trim()}
            >
              {create.isPending ? t("modal.saving") : t("modal.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Link size={15} style={{ color: "var(--accent-text)", flexShrink: 0, marginTop: 1 }} />
          <span>
            {t.rich("modal.mergedFrom", {
              count: candidates.length,
              repo: repoName,
              b: (chunks) => <strong style={{ color: "var(--text-primary)" }}>{chunks}</strong>,
              code: (chunks) => (
                <span className="mono" style={{ color: "var(--accent-text)" }}>
                  {chunks}
                </span>
              ),
            })}
          </span>
        </div>

        {create.isError && (
          <div style={s.error}>
            {create.error instanceof ApiError ? create.error.message : t("modal.failed")}
          </div>
        )}

        <FormField label={t("modal.nameLabel")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>

        <FormField label={t("modal.descriptionLabel")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.row}>
          <div style={s.col}>
            <FormField label={t("modal.typeLabel")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={SKILL_TYPES}
              />
            </FormField>
          </div>
          <div style={s.col}>
            <FormField label={t("modal.enabledLabel")} hint={t("modal.enabledHint")}>
              <Toggle on={enabled} onChange={setEnabled} />
            </FormField>
          </div>
        </div>

        <FormField label={t("modal.agentLabel")} hint={t("modal.agentHint")}>
          <SelectInput value={agentId} onChange={setAgentId} options={agentOptions} mono={false} />
        </FormField>

        <FormField label={t("modal.bodyLabel")} required>
          <div style={s.editor}>
            <div style={s.editorHead}>
              <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
              <span className="mono" style={s.editorFile}>{`${name}.md`}</span>
              <Badge color="var(--text-muted)">{t("modal.unsaved")}</Badge>
              <span className="mono tnum" style={s.tokenCount}>
                {t("modal.tokenCount", { count: approxTokens(body).toLocaleString("en-US") })}
              </span>
            </div>
            <textarea
              className="mono"
              aria-label={t("modal.bodyLabel")}
              value={body}
              rows={14}
              onChange={(e) => setBody(e.target.value)}
              style={s.textarea}
            />
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
