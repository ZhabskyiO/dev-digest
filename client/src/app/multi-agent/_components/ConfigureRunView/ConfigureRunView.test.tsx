import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, PrAgentEstimates, PrMeta, Repo } from "@devdigest/shared";
import runsMessages from "../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../messages/en/prReview.json";
import settingsMessages from "../../../../../messages/en/settings.json";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeRepo(id: string, fullName: string): Repo {
  return {
    id,
    workspace_id: "w1",
    owner: fullName.split("/")[0]!,
    name: fullName.split("/")[1]!,
    full_name: fullName,
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

function makePr(id: string, number: number, title: string): PrMeta {
  return {
    id,
    number,
    title,
    author: "octocat",
    branch: `feat/${number}`,
    base: "main",
    head_sha: "abc123",
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: null,
    cost_usd: null,
    findings_by_severity: null,
  };
}

const REPO_A = makeRepo("repo-a", "acme/payments-api");
const REPO_B = makeRepo("repo-b", "acme/other-repo");

const PR_A1 = makePr("pr-a1", 482, "Add rate limiting to public API endpoints");
const PR_A2 = makePr("pr-a2", 479, "Migrate sessions table to UUID primary key");
const PR_B1 = makePr("pr-b1", 100, "Some other repo PR");

const PULLS_BY_REPO: Record<string, PrMeta[]> = {
  "repo-a": [PR_A1, PR_A2],
  "repo-b": [PR_B1],
};

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

const AGENTS: Agent[] = [makeAgent("a1", "Security"), makeAgent("a2", "Performance")];

const ESTIMATES: PrAgentEstimates = {
  pr_id: "pr-a1",
  agents: [
    { agent_id: "a1", agent_name: "Security", est_duration_ms: 8200, est_cost_usd: 0.06, runs_sampled: 5, last_summary: null },
    { agent_id: "a2", agent_name: "Performance", est_duration_ms: 7400, est_cost_usd: 0.05, runs_sampled: 5, last_summary: null },
  ],
};

let activeRepo = REPO_A;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: activeRepo.id,
    setRepoId: vi.fn(),
    repos: [REPO_A, REPO_B],
    activeRepo,
    reposLoaded: true,
  }),
}));

const startMutate = vi.hoisted(() =>
  vi.fn((_input: unknown, opts?: { onSuccess?: () => void }) => {
    opts?.onSuccess?.();
  }),
);
vi.mock("@/lib/hooks", () => ({
  usePulls: (repoId: string | null | undefined) => ({
    data: repoId ? (PULLS_BY_REPO[repoId] ?? []) : undefined,
  }),
  useAgents: () => ({ data: AGENTS }),
  useAgentEstimates: () => ({ data: ESTIMATES }),
  useStartMultiAgentRun: () => ({
    mutate: startMutate,
    isPending: false,
  }),
}));

import { ConfigureRunView } from "./ConfigureRunView";

function renderView() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ runs: runsMessages, prReview: prReviewMessages, settings: settingsMessages }}
    >
      <ConfigureRunView />
    </NextIntlClientProvider>,
  );
}

function selectPr(label: string | RegExp) {
  fireEvent.click(screen.getByText("Pick a pull request"));
  fireEvent.click(screen.getByText(label));
}

describe("ConfigureRunView", () => {
  it("disables the run control and shows the placeholder instead of the agent list when no PR is selected (AC-1)", () => {
    renderView();

    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("Security")).not.toBeInTheDocument();

    const runButton = screen.getByRole("button", { name: /Run multi-agent review \(0\)/ });
    expect(runButton).toBeDisabled();
  });

  it("offers only the active repository's pull requests in the dropdown (AC-11)", () => {
    activeRepo = REPO_A;
    renderView();

    fireEvent.click(screen.getByText("Pick a pull request"));

    expect(screen.getByText(/#482 · Add rate limiting to public API endpoints/)).toBeInTheDocument();
    expect(screen.getByText(/#479 · Migrate sessions table to UUID primary key/)).toBeInTheDocument();
    expect(screen.queryByText(/Some other repo PR/)).not.toBeInTheDocument();
  });

  it("starts exactly one multi-agent run with the checked agent ids and routes to the results view (AC-10)", () => {
    activeRepo = REPO_A;
    renderView();

    selectPr(/#482 · Add rate limiting to public API endpoints/);

    // Agent list is now rendered — check both agents via "Select all".
    fireEvent.click(screen.getByText("Select all"));

    fireEvent.click(screen.getByRole("button", { name: /Run multi-agent review \(2\)/ }));

    expect(startMutate).toHaveBeenCalledTimes(1);
    expect(startMutate).toHaveBeenCalledWith(
      { prId: "pr-a1", agent_ids: ["a1", "a2"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(push).toHaveBeenCalledWith("/repos/repo-a/pulls/482/multi-agent");
  });
});
