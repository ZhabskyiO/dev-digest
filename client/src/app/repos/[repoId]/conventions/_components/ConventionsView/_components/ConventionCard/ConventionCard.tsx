/* ConventionCard — one extracted house-rule awaiting review: accept it into the
   skill, reject it, or edit its wording and category in place. Purely
   presentational; the parent owns the mutations so this stays easy to test. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, ProgressBar, SelectInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidateDetail, ConventionCategory } from "@devdigest/shared";
import { CATEGORY_COLOR } from "../../constants";
import { categoryColor, formatEvidence } from "../../helpers";
import { s } from "./styles";

export interface ConventionCardProps {
  candidate: ConventionCandidateDetail;
  /** GitHub permalink for the cited line; omitted when the repo isn't known. */
  evidenceUrl?: string | null;
  onStatus: (status: ConventionCandidateDetail["status"]) => void;
  onEdit: (patch: { rule: string; category: ConventionCategory }) => void;
  busy?: boolean;
}

const CATEGORY_KEYS = Object.keys(CATEGORY_COLOR) as ConventionCategory[];

export function ConventionCard({
  candidate,
  evidenceUrl = null,
  onStatus,
  onEdit,
  busy = false,
}: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState(candidate.rule);
  const [draftCategory, setDraftCategory] = React.useState<ConventionCategory>(candidate.category);

  // Re-sync the draft whenever the server echoes back a changed candidate.
  React.useEffect(() => {
    setEditing(false);
    setDraftRule(candidate.rule);
    setDraftCategory(candidate.category);
  }, [candidate.id, candidate.rule, candidate.category]);

  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";

  const save = () => {
    onEdit({ rule: draftRule.trim(), category: draftCategory });
    setEditing(false);
  };

  return (
    <div style={s.card(rejected)}>
      <div style={s.topRow}>
        <div style={s.main}>
          <div style={s.metaRow}>
            <span style={s.categoryChip(categoryColor(candidate.category))}>
              {t(`card.category.${candidate.category}`)}
            </span>
            {rejected && (
              <Badge color="var(--text-muted)" icon="XCircle">
                {t("card.rejected")}
              </Badge>
            )}
          </div>

          {editing ? (
            <>
              <Textarea value={draftRule} onChange={setDraftRule} rows={3} />
              <div style={{ marginTop: 10, maxWidth: 220 }}>
                <SelectInput
                  value={draftCategory}
                  onChange={(v) => setDraftCategory(v as ConventionCategory)}
                  options={CATEGORY_KEYS.map((c) => ({
                    value: c,
                    label: t(`card.category.${c}`),
                  }))}
                  mono={false}
                />
              </div>
              <div style={s.editActions}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Check"
                  onClick={save}
                  disabled={busy || !draftRule.trim()}
                >
                  {t("card.save")}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  {t("card.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <div style={s.rule}>{candidate.rule}</div>
          )}

          <div style={s.evidenceBox}>
            <div style={s.evidenceHead}>
              <span className="mono" style={s.evidencePath}>
                {formatEvidence(candidate)}
              </span>
              {evidenceUrl && (
                <a
                  href={evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t("card.openOnGitHub", { ref: formatEvidence(candidate) })}
                  style={s.githubLink}
                >
                  <Icon.ExternalLink size={11} />
                  {t("card.github")}
                </a>
              )}
            </div>
            <pre className="mono" style={s.snippet}>
              {candidate.evidence_snippet}
            </pre>
          </div>
        </div>

        <div style={s.actions}>
          <Button
            kind="primary"
            size="sm"
            icon="Check"
            full
            onClick={() => onStatus("accepted")}
            disabled={busy || accepted}
          >
            {accepted ? t("card.accepted") : t("card.accept")}
          </Button>
          {rejected ? (
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              full
              onClick={() => onStatus("pending")}
              disabled={busy}
            >
              {t("card.reopen")}
            </Button>
          ) : (
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              full
              onClick={() => onStatus("rejected")}
              disabled={busy}
            >
              {t("card.reject")}
            </Button>
          )}
          {!rejected && !editing && (
            <Button kind="ghost" size="sm" icon="Edit" full onClick={() => setEditing(true)} disabled={busy}>
              {t("card.edit")}
            </Button>
          )}
        </div>
      </div>

      <div style={s.confidenceRow}>
        <span>{t("card.confidence")}</span>
        <div style={s.confidenceBar}>
          <ProgressBar value={candidate.confidence * 100} height={4} />
        </div>
        <span className="mono tnum">{Math.round(candidate.confidence * 100)}%</span>
      </div>
    </div>
  );
}
