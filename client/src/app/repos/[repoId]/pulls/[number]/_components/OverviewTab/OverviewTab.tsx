"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { BriefCard } from "./_components/BriefCard";
import { BlastCard } from "./_components/BlastCard";
import { usePrBrief } from "@/lib/hooks/brief";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** The PR's current head sha — threaded into `BriefCard` for its own
   * stale-vs-current comparison (AC-12). */
  prHeadSha: string;
  /** Oldest-first, HEAD last — see `BriefCard`'s own prop doc for why the
   * ordering matters. */
  prCommits: PrCommit[];
  /** `owner/name` — needed to link a caller's file:line out to GitHub. */
  repoFullName: string | null;
  /** Callers live at repo HEAD, so their links are pinned to this branch. */
  defaultBranch: string | null;
  /** A review-focus entry was activated — jump to that file:line in the
   * Files-changed view (AC-26). */
  onOpenFileLine: (path: string, line: number) => void;
}

export function OverviewTab({
  prId,
  prBody,
  prHeadSha,
  prCommits,
  repoFullName,
  defaultBranch,
  onOpenFileLine,
}: OverviewTabProps) {
  /* Lifted here rather than called again inside each card: TanStack Query
     would dedupe two `usePrBrief(prId)` calls by query key regardless, but
     lifting it makes explicit that the brief is a single source feeding both
     `BriefCard` (its own render) and `BlastCard` (its blast dedupe below). */
  const { data: brief, isLoading: briefLoading } = usePrBrief(prId);

  return (
    <>
      {/* The brief spans the full width of the tab; Intent and Blast sit side
          by side INSIDE it, because reviewers read one against the other: an
          intent scoped to /api/public/* next to a blast radius that names three
          other endpoints is the signal. Blast is handed in as a slot so
          `BriefCard` owns the placement without owning the blast query — this
          component stays the one place that composes the two. */}
      <div style={s.briefRow}>
        <BriefCard
          prId={prId}
          prHeadSha={prHeadSha}
          prCommits={prCommits}
          repoFullName={repoFullName}
          onOpenFileLine={onOpenFileLine}
          blastSlot={
            <BlastCard
              prId={prId}
              repoFullName={repoFullName}
              defaultBranch={defaultBranch}
              blastFromBrief={brief?.blast ?? null}
              briefSettled={!briefLoading}
            />
          }
        />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
