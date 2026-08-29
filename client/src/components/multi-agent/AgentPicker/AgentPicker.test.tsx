import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, PrAgentEstimates } from "@devdigest/shared";
import runsMessages from "../../../../messages/en/runs.json";
import prReviewMessages from "../../../../messages/en/prReview.json";
import { AgentPicker } from "./AgentPicker";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeAgent(id: string, name: string): Agent {
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
    enabled: true,
    version: 1,
  };
}

const AGENTS: Agent[] = [
  makeAgent("a1", "Security"),
  makeAgent("a2", "Performance"),
  makeAgent("a3", "Junior Mentor"),
  makeAgent("a4", "Customer-Facing"),
  makeAgent("a5", "Architecture"),
];

/** Four priced agents (a1–a4 carry a run-on-this-PR summary), plus a5 with
 *  workspace history (an estimate) but no summary for THIS PR. */
const ESTIMATES: PrAgentEstimates = {
  pr_id: "pr1",
  agents: [
    { agent_id: "a1", agent_name: "Security", est_duration_ms: 8200, est_cost_usd: 0.06, runs_sampled: 5, last_summary: "Two critical exposures found." },
    { agent_id: "a2", agent_name: "Performance", est_duration_ms: 7400, est_cost_usd: 0.05, runs_sampled: 5, last_summary: "N+1 in the user list." },
    { agent_id: "a3", agent_name: "Junior Mentor", est_duration_ms: 6900, est_cost_usd: 0.04, runs_sampled: 5, last_summary: "Readable change overall." },
    { agent_id: "a4", agent_name: "Customer-Facing", est_duration_ms: 7100, est_cost_usd: 0.05, runs_sampled: 5, last_summary: "Missing Retry-After header." },
    { agent_id: "a5", agent_name: "Architecture", est_duration_ms: 9100, est_cost_usd: 0.07, runs_sampled: 3, last_summary: null },
  ],
};

function rowFor(name: string): HTMLElement {
  const heading = screen.getByText(name);
  const row = heading.closest('[role="listitem"]');
  if (!row) throw new Error(`no listitem ancestor found for ${name}`);
  return row as HTMLElement;
}

describe("AgentPicker", () => {
  it("renders one card per agent with its summary and estimate, omitting the summary when there is none for this PR (AC-2)", () => {
    renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={ESTIMATES}
        selected={[]}
        onChange={() => {}}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(5);

    expect(within(rowFor("Security")).getByText("Two critical exposures found.")).toBeInTheDocument();
    expect(within(rowFor("Performance")).getByText("N+1 in the user list.")).toBeInTheDocument();
    expect(within(rowFor("Junior Mentor")).getByText("Readable change overall.")).toBeInTheDocument();
    expect(within(rowFor("Customer-Facing")).getByText("Missing Retry-After header.")).toBeInTheDocument();

    // a5 has workspace history (an estimate) but no run on THIS PR: an
    // estimate renders, but no summary paragraph does.
    const architectureRow = rowFor("Architecture");
    expect(within(architectureRow).getByText(/9\.1s/)).toBeInTheDocument();
    expect(architectureRow.querySelector("p")).toBeNull();
  });

  it('shows "Select all" for the full variant, which checks every agent and moves the run label to the full count (AC-3, AC-5)', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={ESTIMATES}
        selected={[]}
        onChange={onChange}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );

    expect(screen.getByText("Select all")).toBeInTheDocument();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Select all"));
    expect(onChange).toHaveBeenCalledWith(["a1", "a2", "a3", "a4", "a5"]);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
        <AgentPicker
          agents={AGENTS}
          estimates={ESTIMATES}
          selected={["a1", "a2", "a3", "a4", "a5"]}
          onChange={onChange}
          variant="full"
          onSubmit={() => {}}
          submitting={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: /Run multi-agent review \(5\)/ })).toBeEnabled();
  });

  it("disables the run control when nothing is checked, and labels it with a partial count otherwise (AC-4, AC-5)", () => {
    const { rerender } = renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={ESTIMATES}
        selected={[]}
        onChange={() => {}}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );
    expect(screen.getByRole("button", { name: /Run multi-agent review \(0\)/ })).toBeDisabled();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
        <AgentPicker
          agents={AGENTS}
          estimates={ESTIMATES}
          selected={["a1", "a2"]}
          onChange={() => {}}
          variant="full"
          onSubmit={() => {}}
          submitting={false}
        />
      </NextIntlClientProvider>,
    );
    const button = screen.getByRole("button", { name: /Run multi-agent review \(2\)/ });
    expect(button).toBeEnabled();
  });

  it('shows "Clear" (not "Select all") for the compact variant, and unchecking every row via Clear reports an empty selection (AC-3, AC-13)', () => {
    const onChange = vi.fn();
    renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={ESTIMATES}
        selected={["a1", "a2"]}
        onChange={onChange}
        variant="compact"
        onSubmit={() => {}}
        submitting={false}
      />,
    );

    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.queryByText("Select all")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders only the agent name and estimate in the compact variant — never the last-run summary (quick picker rows stay one line)", () => {
    renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={ESTIMATES}
        selected={["a1"]}
        onChange={() => {}}
        variant="compact"
        onSubmit={() => {}}
        submitting={false}
      />,
    );

    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.queryByText("Two critical exposures found.")).not.toBeInTheDocument();
    expect(screen.queryByText("N+1 in the user list.")).not.toBeInTheDocument();
  });

  it("marks the aggregate as a lower bound when a checked agent has no estimate at all (AC-8)", () => {
    const partialEstimates: PrAgentEstimates = {
      pr_id: "pr1",
      agents: [ESTIMATES.agents[0]!],
    };
    renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={partialEstimates}
        selected={["a1", "a2"]}
        onChange={() => {}}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );
    expect(screen.getByText(/At least/)).toBeInTheDocument();
  });

  it('never renders "0s" in the aggregate line when every checked agent has a cost estimate but none has a duration estimate (AC-9)', () => {
    const durationlessEstimates: PrAgentEstimates = {
      pr_id: "pr1",
      agents: [
        { agent_id: "a1", agent_name: "Security", est_duration_ms: null, est_cost_usd: 0.06, runs_sampled: 5, last_summary: null },
      ],
    };
    renderWithIntl(
      <AgentPicker
        agents={AGENTS}
        estimates={durationlessEstimates}
        selected={["a1"]}
        onChange={() => {}}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );

    expect(screen.queryByText(/0s/)).not.toBeInTheDocument();
    expect(screen.getByText("$0.060")).toBeInTheDocument();
  });

  it('renders "—" for a null cost estimate and never renders "$0.00" (AC-9)', () => {
    const nullCostEstimates: PrAgentEstimates = {
      pr_id: "pr1",
      agents: [{ agent_id: "a1", agent_name: "Security", est_duration_ms: 8200, est_cost_usd: null, runs_sampled: 5, last_summary: null }],
    };
    const { container } = renderWithIntl(
      <AgentPicker
        agents={[AGENTS[0]!]}
        estimates={nullCostEstimates}
        selected={[]}
        onChange={() => {}}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );
    expect(within(rowFor("Security")).getByText(/—/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("$0.00");
  });

  it("renders the workspace-empty state instead of any agent row when there are no agents (Q6)", () => {
    renderWithIntl(
      <AgentPicker
        agents={[]}
        estimates={undefined}
        selected={[]}
        onChange={() => {}}
        variant="full"
        onSubmit={() => {}}
        submitting={false}
      />,
    );
    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
