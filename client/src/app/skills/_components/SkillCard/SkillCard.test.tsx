import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "uncovered-branch-gate",
  description: "Flags branches with no covering test.",
  type: "rubric",
  source: "manual",
  body: "# Uncovered branch gate\nFlag it.",
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillCard (smoke)", () => {
  it("renders the skill name, type badge and source badge", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("uncovered-branch-gate")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("shows a 'needs vetting' badge for an untrusted, still-disabled skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: false }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does NOT show 'needs vetting' once an imported skill is enabled — the toggle IS the vetting", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: true }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("does NOT show 'needs vetting' for a manual (non-imported) disabled skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "manual", enabled: false }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("calls onClick when the card is clicked", () => {
    const onClick = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onClick={onClick} />);
    fireEvent.click(screen.getByText("uncovered-branch-gate"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onToggle without also triggering onClick (event stops propagation)", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
