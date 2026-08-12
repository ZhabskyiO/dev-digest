"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** `owner/name` — needed to link a caller's file:line out to GitHub. */
  repoFullName: string | null;
  /** Callers live at repo HEAD, so their links are pinned to this branch. */
  defaultBranch: string | null;
}

export function OverviewTab({ prId, prBody, repoFullName, defaultBranch }: OverviewTabProps) {
  return (
    <>
      {/* Why the PR was opened, and what it can reach — side by side, because
          reviewers read one against the other: an intent scoped to /api/public/*
          next to a blast radius that names three other endpoints is the signal. */}
      <div style={s.cardGrid}>
        <IntentCard prId={prId} />
        <BlastCard prId={prId} repoFullName={repoFullName} defaultBranch={defaultBranch} />
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
