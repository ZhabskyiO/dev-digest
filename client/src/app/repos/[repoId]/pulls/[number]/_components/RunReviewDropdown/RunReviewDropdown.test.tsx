import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, PrAgentEstimates, MultiAgentRunStartResponse } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import runsMessages from "../../../../../../../../messages/en/runs.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

function makeAgent(id: string, name: string, enabled: boolean): Agent {
  return {
    id,
    name,
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "You are a reviewer.",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    enabled,
    version: 1,
  };
}

// Two enabled agents (preselected by default) + one disabled agent still
// visible in the picker (AC-12's "row per workspace agent", not just
// enabled ones).
const AGENTS: Agent[] = [
  makeAgent("a1", "Security", true),
  makeAgent("a2", "Performance", true),
  makeAgent("a3", "Draft agent", false),
];

const ESTIMATES: PrAgentEstimates = {
  pr_id: "pr1",
  agents: [
    { agent_id: "a1", agent_name: "Security", est_duration_ms: 8200, est_cost_usd: 0.06, runs_sampled: 5, last_summary: null },
    { agent_id: "a2", agent_name: "Performance", est_duration_ms: 7400, est_cost_usd: 0.05, runs_sampled: 5, last_summary: null },
    { agent_id: "a3", agent_name: "Draft agent", est_duration_ms: null, est_cost_usd: null, runs_sampled: 0, last_summary: null },
  ],
};

const START_RESPONSE: MultiAgentRunStartResponse = {
  multi_run_id: "mrun1",
  pr_id: "pr1",
  runs: [
    { run_id: "run-a1", agent_id: "a1", agent_name: "Security" },
    { run_id: "run-a2", agent_id: "a2", agent_name: "Performance" },
  ],
};

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS }),
}));

const mutateAsync = vi.fn().mockResolvedValue(START_RESPONSE);
const mutate = vi.fn((input: unknown, opts?: { onSuccess?: (res: MultiAgentRunStartResponse) => void; onSettled?: () => void }) => {
  mutateAsync(input);
  opts?.onSuccess?.(START_RESPONSE);
  opts?.onSettled?.();
});
vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: ESTIMATES }),
  useStartMultiAgentRun: () => ({ mutateAsync, mutate, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  mutate.mockClear();
  push.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, runs: runsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function openPicker(props: Partial<React.ComponentProps<typeof RunReviewDropdown>> = {}) {
  renderWithIntl(<RunReviewDropdown prId="pr1" {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /run review/i }));
}

describe("RunReviewDropdown", () => {
  it("shows a checkbox row per agent with its duration estimate, Clear, a run action labelled with the checked count, and the Configure link (AC-12)", () => {
    openPicker();

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/8\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/7\.4s/)).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
    // a1 + a2 preselected (enabled agents) → "Run (2)".
    expect(screen.getByRole("button", { name: /Run \(2\)/ })).toBeInTheDocument();
    expect(screen.getByText("Configure agents")).toBeInTheDocument();
  });

  it('"Clear" unchecks every row and disables the run control (AC-13)', () => {
    openPicker();

    fireEvent.click(screen.getByText("Clear"));

    expect(screen.getByRole("button", { name: /Run \(0\)/ })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveAttribute("aria-checked", "false");
    }
  });

  it('never renders "Run all agents"/"Run all enabled agents", and clicking an agent row only toggles it — never fires a run on its own (AC-14)', () => {
    openPicker();

    expect(screen.queryByText(/Run all agents/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Run all enabled agents/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Security"));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("submits the same { agent_ids } body useStartMultiAgentRun sends for the checked selection, and reports the returned run ids (AC-15)", async () => {
    const onRunsStarted = vi.fn();
    openPicker({ onRunsStarted });

    fireEvent.click(screen.getByRole("button", { name: /Run \(2\)/ }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agent_ids: ["a1", "a2"] });
    await waitFor(() => expect(onRunsStarted).toHaveBeenCalledWith(["run-a1", "run-a2"]));
  });

  it("keeps the run control enabled behind a non-blocking warning for a merged/closed PR (AC-16)", () => {
    openPicker({ warnMerged: true });

    expect(screen.getByText(/Already merged/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run \(2\)/ })).toBeEnabled();
  });

  it("exposes aria-expanded/aria-haspopup on the trigger, and Escape closes the panel and returns focus to it", () => {
    openPicker();

    const trigger = screen.getByRole("button", { name: /run review/i });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText("Clear")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
