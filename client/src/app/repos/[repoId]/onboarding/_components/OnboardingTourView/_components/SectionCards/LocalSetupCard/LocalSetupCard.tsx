/* LocalSetupCard — ordered, discrete shell commands (AC-18), each with its
   own copy-only control (AC-38). There is no way to invoke a command from
   this card — copy is the only affordance a row offers, ever (AC-44): these
   commands come from a model reading third-party repository content and are
   untrusted by construction. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import { IconBtn } from "@devdigest/ui";
import { SectionCard } from "../SectionCard";
import { s } from "./styles";

type LocalSetupSection = Extract<OnboardingSection, { kind: "local_setup" }>;

const COPIED_RESET_MS = 1500;

export function LocalSetupCard({ section }: { section: LocalSetupSection }) {
  const t = useTranslations("onboarding");
  const isEmpty = section.items.length === 0;
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  function handleCopy(index: number, command: string) {
    void navigator.clipboard?.writeText(command);
    setCopiedIndex(index);
    window.setTimeout(() => {
      setCopiedIndex((cur) => (cur === index ? null : cur));
    }, COPIED_RESET_MS);
  }

  return (
    <SectionCard kind="local_setup" icon="Command" isEmpty={isEmpty} emptyReasonCode={section.empty_reason}>
      <ol style={s.list}>
        {section.items.map((item, i) => (
          <li key={`${item.command}-${i}`} style={s.row}>
            <span className="tnum" style={s.index}>
              {i + 1}
            </span>
            <code className="mono" style={s.command}>
              {item.command}
            </code>
            <IconBtn
              icon={copiedIndex === i ? "Check" : "Copy"}
              label={copiedIndex === i ? t("copied") : t("copyCommand", { command: item.command })}
              onClick={() => handleCopy(i, item.command)}
            />
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
