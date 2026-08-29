/* InstallationRow — one deployment row in the CI tab's table: repo, target
 * label, last-run status, relative timestamp, and (AC-8) a stale indicator +
 * Update action when `out_of_date` is true. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { CiInstallationStatus } from "@devdigest/shared";
import { useCiExport } from "@/lib/hooks/ci";
import { statusLabelKey, relativeTime } from "../../helpers";
import { s } from "../../styles";

export function InstallationRow({ agentId, status }: { agentId: string; status: CiInstallationStatus }) {
  const t = useTranslations("ci");
  const exportMut = useCiExport();
  const { installation, last_run, out_of_date } = status;
  const runStatusKey = statusLabelKey(last_run?.status);

  const handleUpdate = () => {
    exportMut.mutate({
      agentId,
      repo: installation.repo,
      target: installation.target_type,
      base: installation.base_branch,
      post_as: installation.post_as,
      triggers: installation.triggers,
    });
  };

  return (
    <div style={s.row}>
      <div style={s.repoCell}>
        <span style={s.repoName}>{installation.repo}</span>
        {out_of_date && <span style={s.staleNote}>{t("ciTab.outOfDate")}</span>}
      </div>
      <span>{t(`exportWizard.targets.${installation.target_type}`)}</span>
      {runStatusKey ? <Badge>{t(`runs.status.${runStatusKey}`)}</Badge> : <span style={s.muted}>—</span>}
      <span className="tnum" style={s.muted}>
        {relativeTime(last_run?.ran_at)}
      </span>
      {out_of_date ? (
        <Button kind="secondary" size="sm" disabled={exportMut.isPending} onClick={handleUpdate}>
          {exportMut.isPending ? t("ciTab.updating") : t("ciTab.updateAction")}
        </Button>
      ) : (
        <span style={s.muted}>—</span>
      )}
    </div>
  );
}
