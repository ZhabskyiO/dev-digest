import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentRunStats, SkillUsage } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

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

let usageData: SkillUsage[] = [];
let usageLoading = false;
let statsData: AgentRunStats | undefined;
let statsLoading = false;

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkillUsage: () => ({ data: usageData, isLoading: usageLoading }),
}));

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentStats: () => ({ data: statsData, isLoading: statsLoading }),
}));

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  usageData = [];
  usageLoading = false;
  statsData = undefined;
  statsLoading = false;
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      <StatsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("StatsTab (smoke)", () => {
  it("shows an empty-state note when there is no usage yet", () => {
    renderWithIntl();
    expect(screen.getByText("Most-used skills")).toBeInTheDocument();
    expect(screen.getByText(/No skill usage yet/i)).toBeInTheDocument();
  });

  it("renders one bar row per skill with its run count and percentage", () => {
    usageData = [
      { skill_id: "sk1", name: "uncovered-branch-gate", type: "rubric", runs: 8, pct: 80 },
      { skill_id: "sk2", name: "mock-overuse", type: "convention", runs: 2, pct: 20 },
    ];
    renderWithIntl();
    expect(screen.getByText("uncovered-branch-gate")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("mock-overuse")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("shows the skill-using-runs denominator caveat, not a share-of-all-runs claim", () => {
    renderWithIntl();
    const caveat = screen.getByText(/skill-using runs/i);
    expect(caveat).toBeInTheDocument();
  });

  it("renders the 4 KPI tiles from real agent-run stats", () => {
    statsData = {
      runs: 142,
      accept_rate: 78,
      avg_cost_usd: 0.0421,
      avg_cost_usd_delta: -0.01,
      avg_duration_ms: 6234,
      trend: [1, 3, 2, 4, 5, 4, 6],
    };
    renderWithIntl();
    expect(screen.getByText("TOTAL RUNS (30D)")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("AVG COST / RUN")).toBeInTheDocument();
    expect(screen.getByText("$0.042")).toBeInTheDocument();
    expect(screen.getByText("AVG DURATION")).toBeInTheDocument();
    expect(screen.getByText("6.2s")).toBeInTheDocument();
    expect(screen.getByText("ACCEPT RATE")).toBeInTheDocument();
    // "78" appears twice: the big tile value and the RingProgress badge's centered label.
    expect(screen.getAllByText("78").length).toBe(2);
  });

  it("shows an em dash rather than a fake 0 for a brand-new agent with no runs yet", () => {
    statsData = { runs: 0, accept_rate: null, avg_cost_usd: null, avg_cost_usd_delta: null, avg_duration_ms: null, trend: [] };
    renderWithIntl();
    expect(screen.getByText("0")).toBeInTheDocument(); // TOTAL RUNS is genuinely 0
    // avg cost / avg duration / accept rate all render the shared "—" NO_VALUE token.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
});
