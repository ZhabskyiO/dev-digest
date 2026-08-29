import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRunList, CiRunListItem } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";

const push = vi.fn();
const replace = vi.fn();
let searchParamsValue = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "ag1", name: "Security Reviewer" }] }),
}));

vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: [{ id: "r1", full_name: "acme/payments-api" }] }),
}));

vi.mock("@/lib/hooks/useDocumentVisible", () => ({
  useDocumentVisible: () => true,
}));

const refreshMutate = vi.fn();
let refreshResult: {
  data: CiRunList | undefined;
  isPending: boolean;
  isError: boolean;
} = { data: undefined, isPending: false, isError: false };
let ciRunsResult: {
  data: CiRunList | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};
vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: () => ciRunsResult,
  useRefreshCiRuns: () => ({ mutate: refreshMutate, ...refreshResult }),
}));

import { CiRunsView } from "./CiRunsView";
import { NAV } from "../../../../vendor/ui/nav";

const SUCCEEDED_RUN: CiRunListItem = {
  id: "run-1",
  ci_installation_id: "inst-1",
  pr_number: 42,
  ran_at: "2026-08-20T10:00:00Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.05,
  github_url: "https://github.com/acme/payments-api/actions/runs/123",
  source: "gha",
  agent: "Security Reviewer",
  duration_s: 12,
  error: null,
  repo: "acme/payments-api",
  agent_id: "ag1",
};

const RUNNING_RUN: CiRunListItem = {
  ...SUCCEEDED_RUN,
  id: "run-2",
  pr_number: 43,
  status: "running",
  findings_count: null,
  cost_usd: null,
  github_url: null,
};

const SKIPPED_RUN: CiRunListItem = {
  ...SUCCEEDED_RUN,
  id: "run-3",
  pr_number: 44,
  status: "skipped",
  findings_count: null,
  cost_usd: null,
  github_url: null,
  error: "Fork PR — review job did not run",
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CiRunsView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParamsValue = "";
  refreshResult = { data: undefined, isPending: false, isError: false };
});

describe("CiRunsView", () => {
  it("renders the six columns, four filters, and a per-row GitHub link (AC-46)", () => {
    ciRunsResult = {
      data: { items: [SUCCEEDED_RUN], total: 1, refresh_error: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    renderView();

    for (const col of ["Timestamp", "Pull request", "Source", "Findings", "Cost", "Status"]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }

    // Four filter controls: time window, agent, repository, status.
    expect(screen.getAllByRole("combobox")).toHaveLength(4);

    const link = screen.getByRole("link", { name: "View" });
    expect(link).toHaveAttribute("href", SUCCEEDED_RUN.github_url);
  });

  it("renders the empty-state copy instead of an empty table when zero rows have ever been ingested (AC-47)", () => {
    ciRunsResult = {
      data: { items: [], total: 0, refresh_error: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    renderView();

    expect(screen.getByText(ciMessages.runs.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.runs.emptyBody)).toBeInTheDocument();
    expect(screen.queryByText("Timestamp")).not.toBeInTheDocument();
  });

  it("keeps previously fetched rows rendered and shows a refresh-failed indication plus the specific reason when the response carries refresh_error (AC-45)", () => {
    ciRunsResult = {
      data: { items: [SUCCEEDED_RUN], total: 1, refresh_error: "GitHub rate-limited the request" },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    renderView();

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText(ciMessages.runs.refreshFailed)).toBeInTheDocument();
    expect(screen.getByText(/GitHub rate-limited the request/)).toBeInTheDocument();
  });

  it("sources the reason from the refresh mutation's own response when GET /ci-runs carries no refresh_error (AC-45)", () => {
    // Mirrors production: the plain GET /ci-runs list always returns
    // `refresh_error: null` — only POST /ci-runs/refresh's response does.
    ciRunsResult = {
      data: { items: [SUCCEEDED_RUN], total: 1, refresh_error: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    refreshResult = {
      data: { items: [SUCCEEDED_RUN], total: 1, refresh_error: "401 Bad credentials" },
      isPending: false,
      isError: false,
    };
    renderView();

    expect(screen.getByText(ciMessages.runs.refreshFailed)).toBeInTheDocument();
    expect(screen.getByText(/401 Bad credentials/)).toBeInTheDocument();
  });

  it("renders a running row with visible status text, not colour alone (AC-41)", () => {
    ciRunsResult = {
      data: { items: [RUNNING_RUN], total: 1, refresh_error: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    renderView();

    // The status pill conveys state via visible translated text (and an
    // `aria-hidden` icon), not a per-row `role="status"` live region — that
    // would re-announce on every 30s poll tick (see RunRow.tsx's guard).
    // Scoped to the pill's own `<span>` — the filters bar's status `<select>`
    // also has a "Running" option with the same text.
    expect(screen.getByText(ciMessages.runs.status.running, { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders a skipped row with visible \"Skipped\" text, not colour alone", () => {
    ciRunsResult = {
      data: { items: [SKIPPED_RUN], total: 1, refresh_error: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    renderView();

    expect(screen.getByText("#44")).toBeInTheDocument();
    expect(screen.getByText(ciMessages.runs.status.skipped, { selector: "span" })).toBeInTheDocument();
  });
});

describe("nav.ts — CI Runs entry (AC-48)", () => {
  it("adds a ci-runs item routing to /ci-runs", () => {
    const allItems = NAV.flatMap((g) => g.items);
    const ciRunsItem = allItems.find((i) => i.key === "ci-runs");
    expect(ciRunsItem).toBeDefined();
    expect(ciRunsItem?.href).toBe("/ci-runs");
  });
});
