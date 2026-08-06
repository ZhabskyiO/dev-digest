/* VersionsTab — the skill's body history. Each save that changed the body left a
   snapshot; Diff compares one against the current body, and Restore re-applies
   it as a NEW version rather than rewinding, so the snapshots past eval runs
   were scored against survive. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import {
  useRestoreSkillVersion,
  useSkillVersions,
} from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { collapseUnchanged, diffLines, isIdentical } from "./helpers";
import { s } from "./styles";

const SKELETON_ROWS = 3;

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);

  const rows = versions ?? [];
  // Versions arrive newest-first, so the head is the live body.
  const currentVersion = rows[0]?.version ?? skill.version;

  const doRestore = (version: number) => {
    restore.mutate(
      { skillId: skill.id, version },
      {
        onSuccess: (data) => {
          setOpenDiff(null);
          toast.success(
            t("versions.restoredToast", { version, newVersion: data.version }),
          );
        },
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.h2}>{t("versions.heading")}</h2>
        {rows.length > 0 && (
          <Badge color="var(--text-secondary)">
            {t("versions.count", { count: rows.length })}
          </Badge>
        )}
      </div>
      <p style={s.subtitle}>{t("versions.subtitle")}</p>

      {isLoading ? (
        <div style={s.list}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={68} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title={t("versions.loadError")} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <div style={s.empty}>{t("versions.empty")}</div>
      ) : (
        <div style={s.list}>
          {rows.map((v) => {
            const isCurrent = v.version === currentVersion;
            const showDiff = openDiff === v.version;
            const diff = showDiff ? diffLines(v.body, skill.body) : [];

            return (
              <div key={v.version}>
                <div style={s.row}>
                  <span className="mono" style={s.versionPill}>{`v${v.version}`}</span>
                  <div style={s.rowMain}>
                    {v.label ? (
                      <div style={s.label}>{v.label}</div>
                    ) : (
                      <div style={s.unlabelled}>{t("versions.unlabelled")}</div>
                    )}
                    <div className="tnum" style={s.date}>
                      {new Date(v.created_at).toLocaleDateString("en-CA")}
                    </div>
                  </div>
                  <div style={s.rowActions}>
                    {isCurrent ? (
                      <Badge color="var(--ok)" dot>
                        {t("versions.current")}
                      </Badge>
                    ) : (
                      <>
                        <Button
                          kind="ghost"
                          size="sm"
                          icon="Eye"
                          onClick={() => setOpenDiff(showDiff ? null : v.version)}
                        >
                          {showDiff ? t("versions.hideDiff") : t("versions.diff")}
                        </Button>
                        <Button
                          kind="secondary"
                          size="sm"
                          icon="History"
                          onClick={() => doRestore(v.version)}
                          disabled={restore.isPending}
                        >
                          {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {showDiff && (
                  <div style={s.diffBox}>
                    <div style={s.diffHead}>
                      {t("versions.diffHeading", { version: v.version })}
                    </div>
                    {isIdentical(diff) ? (
                      <div style={s.identical}>{t("versions.diffIdentical")}</div>
                    ) : (
                      <div style={s.diffScroll}>
                        {collapseUnchanged(diff).map((row, i) => (
                          <div key={i} style={s.diffLine(row.kind)}>
                            <span className="mono tnum" style={s.diffNo}>
                              {row.newNo ?? row.oldNo ?? ""}
                            </span>
                            <span className="mono" style={s.diffSign(row.kind)}>
                              {row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}
                            </span>
                            <span className="mono" style={s.diffText}>
                              {row.text || " "}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
