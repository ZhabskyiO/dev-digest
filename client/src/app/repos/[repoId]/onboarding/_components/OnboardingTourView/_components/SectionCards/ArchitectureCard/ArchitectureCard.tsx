/* ArchitectureCard — markdown body + optional mermaid diagram. Reuses the
   shared `Markdown` (no rehype-raw, so embedded HTML/script renders as
   escaped, inert text — AC-43) and `MermaidDiagram` (validates with
   mermaid.parse before rendering and returns null on invalid input, so a bad
   diagram never blocks the body and never shows a "Syntax error" graphic —
   AC-14). */
"use client";

import type { OnboardingSection } from "@devdigest/shared";
import { Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { SectionCard } from "../SectionCard";
import { stripMarkdownLinks } from "./helpers";
import { s } from "./styles";

type ArchitectureSection = Extract<OnboardingSection, { kind: "architecture" }>;

export function ArchitectureCard({ section }: { section: ArchitectureSection }) {
  const isEmpty = section.body.trim().length === 0;
  return (
    <SectionCard kind="architecture" icon="GitBranch" isEmpty={isEmpty}>
      <div style={s.prose}>
        <Markdown>{stripMarkdownLinks(section.body)}</Markdown>
      </div>
      {section.diagram && <MermaidDiagram chart={section.diagram} />}
    </SectionCard>
  );
}
