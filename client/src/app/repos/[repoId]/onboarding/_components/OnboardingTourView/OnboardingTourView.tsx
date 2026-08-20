/* OnboardingTourView — /repos/:repoId/onboarding. Composes T9's six section
   cards under T11's own TourHeader + TableOfContents, and owns every page
   state: `not_indexed` (index-first empty state, AC-6), `empty` (the
   corrected generate.* copy with a single generate action, AC-41), a stored
   tour rendered in full underneath whichever notices apply to it —
   generating (Regenerate disabled, AC-26/AC-27), failed (dismissible,
   previous tour intact, AC-28), degraded (AC-7), stale (AC-29) — with all
   six sections always rendered (AC-30). Repository `full_name` /
   `default_branch` come from `useActiveRepo()`, which already derives the
   repo from the `/repos/:id` path segment. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { OnboardingSectionKind } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useOnboardingTour, useGenerateOnboardingTour } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import {
  ArchitectureCard,
  CriticalPathsCard,
  RoutesAndApisCard,
  LocalSetupCard,
  ReadingPathCard,
  FirstTasksCard,
} from "./_components/SectionCards";
import { TourHeader } from "./_components/TourHeader";
import { TableOfContents } from "./_components/TableOfContents";
import { SHARE_COPIED_RESET_MS, SKELETON_CARD_COUNT } from "./constants";
import { buildShareUrl, orderedSections } from "./helpers";
import { s } from "./styles";

/**
 * Scrollspy: which section is currently in view. Genuinely external-system
 * state (scroll position via IntersectionObserver), not something derivable
 * from props/state during render — the useState+useEffect pair here is the
 * legitimate case, not the anti-pattern. The setter is also handed to
 * TableOfContents so activating an entry moves the marker immediately,
 * without waiting on the next observer tick.
 */
function useActiveSection(kinds: OnboardingSectionKind[]) {
  const [active, setActive] = React.useState<OnboardingSectionKind | null>(kinds[0] ?? null);
  const kindsKey = kinds.join("|");

  React.useEffect(() => {
    const elements = kinds
      .map((kind) => document.getElementById(kind))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActive(topmost.target.id as OnboardingSectionKind);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // `kindsKey` stands in for `kinds` — the observer only needs to re-attach
    // when the set of section ids actually changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey]);

  return [active, setActive] as const;
}

export function OnboardingTourView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const pathname = usePathname();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateOnboardingTour(repoId);

  const tour = data?.tour ?? null;
  const sections = React.useMemo(() => (tour ? orderedSections(tour.sections) : []), [tour]);
  const kinds = React.useMemo(() => sections.map((section) => section.kind), [sections]);
  const [activeKind, setActiveKind] = useActiveSection(kinds);

  const [failedDismissed, setFailedDismissed] = React.useState(false);
  const [shareCopied, setShareCopied] = React.useState(false);

  const crumb = [{ label: activeRepo?.full_name ?? repoId }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  async function handleShare() {
    const url = buildShareUrl(window.location.origin, pathname ?? "", activeKind);
    await navigator.clipboard?.writeText(url);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), SHARE_COPIED_RESET_MS);
  }

  const isGenerating = data?.state === "generating";
  const regenerateDisabled = isGenerating || generate.isPending;

  return (
    <AppShell crumb={crumb}>
      <div style={s.content}>
        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
              <Skeleton key={i} height={140} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("loadError.title")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : tour ? (
          <div style={s.layout}>
            <div style={s.tocRail}>
              <TableOfContents kinds={kinds} activeKind={activeKind} onActivate={setActiveKind} />
            </div>
            <div style={s.main}>
              <TourHeader
                repoFullName={activeRepo?.full_name}
                tour={tour}
                state={data?.state ?? "ready"}
                stale={data?.stale ?? false}
                failureReason={data?.state === "failed" ? (data?.failure_reason ?? null) : null}
                failedDismissed={failedDismissed}
                onDismissFailed={() => setFailedDismissed(true)}
                regenerateDisabled={regenerateDisabled}
                isGenerating={isGenerating}
                onRegenerate={() => generate.mutate()}
                onShare={handleShare}
                shareCopied={shareCopied}
              />
              <div style={s.cards}>
                {sections.map((section) => {
                  switch (section.kind) {
                    case "architecture":
                      return <ArchitectureCard key={section.kind} section={section} />;
                    case "critical_paths":
                      return (
                        <CriticalPathsCard
                          key={section.kind}
                          section={section}
                          repoFullName={activeRepo?.full_name}
                          revision={tour.indexed_revision}
                          defaultBranch={activeRepo?.default_branch}
                        />
                      );
                    case "routes_and_apis":
                      return <RoutesAndApisCard key={section.kind} section={section} />;
                    case "local_setup":
                      return <LocalSetupCard key={section.kind} section={section} />;
                    case "reading_path":
                      return <ReadingPathCard key={section.kind} section={section} />;
                    case "first_tasks":
                      return <FirstTasksCard key={section.kind} section={section} />;
                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          </div>
        ) : data?.state === "not_indexed" ? (
          <EmptyState icon="GitBranch" title={t("notIndexed.title")} body={t("notIndexed.body")} />
        ) : data?.state === "generating" ? (
          <EmptyState icon="RefreshCw" title={t("generate.generating")} body={t("notice.generating")} />
        ) : (
          <EmptyState
            icon="Sparkles"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={t("generate.cta")}
            onCta={() => generate.mutate()}
            ctaLoading={generate.isPending}
          />
        )}
      </div>
    </AppShell>
  );
}
