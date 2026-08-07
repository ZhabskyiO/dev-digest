import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric.",
  type: "rubric",
  source: "manual",
  body: "# Title",
  enabled: true,
  version: 3,
};

let statsData: SkillStats | undefined;
let statsLoading = false;
let agentsData: Agent[] = [];

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkillStats: () => ({ data: statsData, isLoading: statsLoading }),
  useSkillAgents: () => ({ data: agentsData, isLoading: false }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  statsData = undefined;
  statsLoading = false;
  agentsData = [];
  vi.clearAllMocks();
});

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-4o-mini",
    system_prompt: "review",
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("StatsTab", () => {
  it("renders the four tiles from real numbers", () => {
    statsData = {
      agents_using: 3,
      runs: 12,
      pull_pct: 71,
      accept_rate: 74,
      findings: 96,
      by_category: [{ category: "security", count: 52 }],
    };
    renderTab();

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    // 74 appears twice: the tile value and the RingProgress label.
    expect(screen.getAllByText("74").length).toBe(2);
  });

  it("renders — rather than 0% for ratios the server could not compute", () => {
    statsData = {
      agents_using: 1,
      runs: 0,
      pull_pct: null,
      accept_rate: null,
      findings: 0,
      by_category: [],
    };
    renderTab();

    // Two unknown ratios → two em dashes. A skill with no triaged findings has
    // an unknown accept rate, not a 0% one.
    expect(screen.getAllByText("—").length).toBe(2);
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("always states the attribution caveat", () => {
    statsData = {
      agents_using: 1,
      runs: 1,
      pull_pct: 50,
      accept_rate: 50,
      findings: 2,
      by_category: [],
    };
    renderTab();
    expect(screen.getByText(messages.stats.caveat)).toBeInTheDocument();
  });

  it("lists the agents using the skill", () => {
    statsData = {
      agents_using: 2,
      runs: 1,
      pull_pct: 50,
      accept_rate: null,
      findings: 0,
      by_category: [],
    };
    agentsData = [agent(), agent({ id: "a2", name: "Performance Reviewer" })];
    renderTab();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText(messages.stats.open).length).toBe(2);
  });

  it("says so when the skill is attached to nothing", () => {
    statsData = {
      agents_using: 0,
      runs: 0,
      pull_pct: null,
      accept_rate: null,
      findings: 0,
      by_category: [],
    };
    renderTab();
    expect(screen.getByText(messages.stats.agentsEmpty)).toBeInTheDocument();
    expect(screen.getByText(messages.stats.categoryEmpty)).toBeInTheDocument();
  });

  it("shows skeletons instead of zeros while loading", () => {
    statsLoading = true;
    renderTab();
    expect(screen.queryByText("0")).toBeNull();
  });
});
