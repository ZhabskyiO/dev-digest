import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, MultiAgentRun, PrMeta, Repo } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../../../../messages/en/prReview.json";

// ---- jsdom has no EventSource; useRunEvents (owned by this page) opens one
// per running run_id. Stub it before rendering so the AC-36 replay test can
// drive a real event through the real hook + AgentColumns (client/insights/
// gotchas.md 2026-08-20 pattern, prescribed for this task's `EventSource`
// case in the plan's Known gotchas). ----
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener = vi.fn();
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}
// @ts-expect-error — test stub, not a full EventSource implementation.
global.EventSource = MockEventSource;

const REPO: Repo = {
  id: "repo-1",
  workspace_id: "w1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

function makePr(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add pagination fix",
    author: "octocat",
    branch: "feat/pagination",
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
    ...overrides,
  };
}

function makeColumn(overrides: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Agent Alpha",
    provider: "openai",
    model: "gpt-5",
    status: "done",
    verdict: "approved",
    score: 82,
    summary: "Looks solid overall.",
    duration_ms: 4200,
    cost_usd: 0.045,
    error: null,
    findings: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "multi-1",
    pr_id: "pr-1",
    pr_number: 482,
    ran_at: "2026-08-27T00:00:00Z",
    agent_count: 2,
    status: "complete",
    total_duration_ms: 5000,
    total_cost_usd: 0.05,
    shared_error: null,
    columns: [makeColumn(), makeColumn({ run_id: "run-2", agent_name: "Agent Beta" })],
    conflicts: [],
    ...overrides,
  };
}

let searchParamsValue = "";
const push = vi.fn();
const replace = vi.fn((url: string) => {
  const qIndex = url.indexOf("?");
  searchParamsValue = qIndex >= 0 ? url.slice(qIndex + 1) : "";
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1", number: "482" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: REPO.id,
    setRepoId: vi.fn(),
    repos: [REPO],
    activeRepo: REPO,
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

let pulls: PrMeta[] = [makePr()];
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    usePulls: () => ({ data: pulls, isLoading: false }),
  };
});

let run: MultiAgentRun | null = makeRun();
vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentRun: () => ({ data: run, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

import { MultiAgentResults } from "./MultiAgentResults";

function renderResults() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
        <MultiAgentResults />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsValue = "";
  pulls = [makePr()];
  run = makeRun();
  MockEventSource.instances = [];
});

describe("MultiAgentResults — AC-32 (exactly two modes, selection survives a reload of the same URL)", () => {
  it("selecting Tabs and remounting with the same search params leaves Tabs selected", () => {
    const { unmount } = renderResults();

    // Default view is Columns — the Tabs-only summary card isn't shown yet.
    expect(screen.queryByText("Looks solid overall.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("/repos/repo-1/pulls/482/multi-agent?view=tabs"),
    );
    expect(searchParamsValue).toBe("view=tabs");

    // Simulate a real reload: unmount, then mount a fresh instance against
    // the SAME (now-updated) search params.
    unmount();
    renderResults();

    expect(screen.getByRole("button", { name: "Tabs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Looks solid overall.")).toBeInTheDocument();
  });
});

describe("MultiAgentResults — AC-36 (mid-run mount resumes the live feed without dropping pre-mount events)", () => {
  it("shows an event delivered right after the shared subscription opens", () => {
    run = makeRun({
      status: "running",
      columns: [
        makeColumn({ run_id: "run-live", agent_name: "Agent Live", status: "running", score: null }),
      ],
    });

    renderResults();

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0]!;
    expect(source.url).toContain("run-live");

    // The server's replay buffer flushes any backlog the moment the stream
    // opens — from this component's perspective that's just the very first
    // message arriving on the one shared EventSource it owns.
    act(() => {
      source.onmessage?.({
        data: JSON.stringify({
          runId: "run-live",
          seq: 1,
          kind: "info",
          msg: "Analyzing changed files…",
          t: "00.31",
        }),
      } as MessageEvent);
    });

    expect(screen.getByText("Analyzing changed files…")).toBeInTheDocument();
  });
});

describe("MultiAgentResults — AC-38 (a shared pre-work failure renders ONCE at the multi-run level)", () => {
  it("renders exactly one run-level error banner, not one per column", () => {
    const reason = "Model provider outage";
    run = makeRun({
      status: "complete",
      shared_error: reason,
      columns: [
        makeColumn({ run_id: "run-1", status: "failed", error: reason, score: null }),
        makeColumn({ run_id: "run-2", status: "failed", error: reason, score: null }),
        makeColumn({ run_id: "run-3", status: "failed", error: reason, score: null }),
        makeColumn({ run_id: "run-4", status: "failed", error: reason, score: null }),
      ],
    });

    renderResults();

    const banners = screen.getAllByRole("alert");
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent(reason);
  });
});

describe('MultiAgentResults — AC-44 ("Where agents disagree" renders in both modes)', () => {
  it("renders the disagreement block in Columns mode and after switching to Tabs", () => {
    run = makeRun({
      conflicts: [
        {
          file: "src/a.ts",
          start_line: 10,
          end_line: 12,
          title: "Null check disagreement",
          takes: [
            { agent_id: "agent-1", agent_name: "Agent Alpha", verdict: "WARNING", note: null },
            { agent_id: "agent-2", agent_name: "Agent Beta", verdict: "ignored", note: null },
          ],
        },
      ],
    });

    renderResults();
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
  });
});

describe("MultiAgentResults — no run yet (deep link/reload before any run exists)", () => {
  it("renders the empty state and neither the disagreement block nor any column", () => {
    run = null;

    renderResults();

    expect(screen.getByText(runsMessages.page.noRun.title)).toBeInTheDocument();
    expect(screen.getByText(runsMessages.page.noRun.bodyReady)).toBeInTheDocument();
    // The header's own Configure button carries the same label — both are
    // legitimate "go configure a run" affordances in the empty state.
    expect(screen.getAllByRole("button", { name: runsMessages.page.noRun.cta })).toHaveLength(2);

    expect(screen.queryByText("Where agents disagree")).not.toBeInTheDocument();
    expect(screen.queryByText("Looks solid overall.")).not.toBeInTheDocument();
  });
});

describe("MultiAgentResults — AC-46 (header states agent count, total duration, total cost, and the PR)", () => {
  it("renders all four in the header", () => {
    run = makeRun({ agent_count: 4, total_duration_ms: 8200, total_cost_usd: 1.2 });
    pulls = [makePr({ number: 482, title: "Add pagination fix" })];

    renderResults();

    expect(screen.getByText("PR #482 · Add pagination fix")).toBeInTheDocument();
    expect(
      screen.getByText("4 agents · fan-out via p-queue · 8.2s total · $1.20"),
    ).toBeInTheDocument();
  });
});
