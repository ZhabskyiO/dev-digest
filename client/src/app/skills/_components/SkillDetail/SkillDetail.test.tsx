import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\n\nEvaluate the pull request.",
  enabled: true,
  version: 5,
};

// Each tab owns its own data hooks (and ConfigTab pulls in CodeMirror, which
// needs a real layout); this suite covers the shell — header + tab routing.
vi.mock("./_components/ConfigTab", () => ({
  ConfigTab: () => <div data-testid="tab-body">config</div>,
}));
vi.mock("./_components/PreviewTab", () => ({
  PreviewTab: () => <div data-testid="tab-body">preview</div>,
}));
vi.mock("./_components/StatsTab", () => ({
  StatsTab: () => <div data-testid="tab-body">stats</div>,
}));
vi.mock("./_components/VersionsTab", () => ({
  VersionsTab: () => <div data-testid="tab-body">versions</div>,
}));

import { SkillDetail } from "./SkillDetail";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDetail(tab = "config", onTab = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillDetail skill={SKILL} tab={tab} onTab={onTab} />
    </NextIntlClientProvider>,
  );
  return onTab;
}

describe("SkillDetail", () => {
  it("shows the skill name, type and version in the header", () => {
    renderDetail();
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
  });

  it("offers exactly the four tabs", () => {
    renderDetail();
    for (const label of Object.values(messages.editor.tabs)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Evals and CI are not built — they must not appear.
    expect(screen.queryByText("Evals")).toBeNull();
    expect(screen.queryByText("CI")).toBeNull();
  });

  it.each([
    ["config", "config"],
    ["preview", "preview"],
    ["stats", "stats"],
    ["versions", "versions"],
  ])("renders the %s tab body", (tab, expected) => {
    renderDetail(tab);
    expect(screen.getByTestId("tab-body")).toHaveTextContent(expected);
  });

  it("falls back to Config for an unknown tab value", () => {
    renderDetail("bogus");
    expect(screen.getByTestId("tab-body")).toHaveTextContent("config");
  });

  it("reports a tab click upward rather than holding it locally", () => {
    const onTab = renderDetail("config");
    fireEvent.click(screen.getByText(messages.editor.tabs.versions));
    expect(onTab).toHaveBeenCalledWith("versions");
  });
});
