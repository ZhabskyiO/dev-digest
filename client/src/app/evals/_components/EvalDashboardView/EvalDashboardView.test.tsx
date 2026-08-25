import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalPipelineDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const DASHBOARD: EvalPipelineDashboard = {
  agents: [
    {
      agent_id: "ag1",
      agent_name: "Security Reviewer",
      model: "gpt-4.1",
      enabled: true,
      cases_total: 5,
      latest: {
        batch_id: "b1",
        agent_id: "ag1",
        agent_name: "Security Reviewer",
        agent_version: 7,
        model: "gpt-4.1",
        provider: "openai",
        ran_at: "2026-08-24T09:14:00Z",
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        passed: 17,
        total: 20,
        duration_ms: 4000,
        cost_usd: 0.23,
      },
      delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
      trend: [0.76, 0.78, 0.82],
    },
  ],
  recent: [
    {
      batch_id: "b1",
      agent_id: "ag1",
      agent_name: "Security Reviewer",
      agent_version: 7,
      model: "gpt-4.1",
      provider: "openai",
      ran_at: "2026-08-24T09:14:00Z",
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.95,
      passed: 17,
      total: 20,
      duration_ms: 4000,
      cost_usd: 0.23,
    },
  ],
};

vi.mock("../../../../lib/hooks/evals", () => ({
  useEvalDashboard: () => ({ data: DASHBOARD, isLoading: false }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("shows each agent's latest metrics and case count", () => {
    renderView();
    expect(screen.getByText("Eval Dashboard")).toBeInTheDocument();
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("82%").length).toBeGreaterThan(0);
    expect(screen.getByText(/5 cases/)).toBeInTheDocument();
    expect(screen.getAllByTestId("eval-recent-row")).toHaveLength(1);
  });

  it("navigates to the agent's Evals tab on click", () => {
    renderView();
    fireEvent.click(screen.getByTestId("eval-agent-row"));
    expect(push).toHaveBeenCalledWith("/agents/ag1?tab=evals");
  });
});
