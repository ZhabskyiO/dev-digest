import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review tests.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const CATALOG: Skill[] = [
  { id: "sk1", name: "uncovered-branch-gate", description: "", type: "rubric", source: "manual", body: "", enabled: true, version: 1 },
  { id: "sk2", name: "corner-case-checklist", description: "", type: "rubric", source: "manual", body: "", enabled: true, version: 1 },
  { id: "sk3", name: "mock-overuse", description: "", type: "convention", source: "manual", body: "", enabled: true, version: 1 },
];

// Only sk1 is attached, at order 0.
const LINKS: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "sk1", order: 0 }];

const setAgentSkillsMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: CATALOG, isLoading: false }),
  useAgentSkills: () => ({ data: LINKS, isLoading: false }),
  useSetAgentSkills: () => ({ mutate: setAgentSkillsMutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, skills: skillsMessages }}>
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab (smoke)", () => {
  it("shows the enabled-count header and splits attached vs. unattached skills", () => {
    renderWithIntl();
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    // Attached row is checked, unattached rows are not.
    const switches = screen.getAllByRole("checkbox");
    expect(switches).toHaveLength(3);
    expect(switches[0]).toBeChecked(); // uncovered-branch-gate (attached)
    expect(switches[1]).not.toBeChecked(); // corner-case-checklist
    expect(switches[2]).not.toBeChecked(); // mock-overuse
  });

  it("attaching an unattached skill POSTs the full ordered set including it", () => {
    renderWithIntl();
    const switches = screen.getAllByRole("checkbox");
    fireEvent.click(switches[1]!); // attach corner-case-checklist
    expect(setAgentSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk1", "sk2"] });
  });

  it("detaching the only attached skill POSTs an empty ordered set", () => {
    renderWithIntl();
    const switches = screen.getAllByRole("checkbox");
    fireEvent.click(switches[0]!); // detach uncovered-branch-gate
    expect(setAgentSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: [] });
  });

  it("filters both sections by name", () => {
    renderWithIntl();
    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), { target: { value: "mock" } });
    expect(screen.queryByText("uncovered-branch-gate")).not.toBeInTheDocument();
    expect(screen.getByText("mock-overuse")).toBeInTheDocument();
  });
});
