import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallationStatus } from "@devdigest/shared";
// Same relative depth as ExportWizard.test.tsx (`_components/AgentEditor/
// _components/<Name>/*.test.tsx`) — see client/insights/gotchas.md's
// 2026-08-04 entry on why the exact `../` count matters here.
import messages from "../../../../../../../../messages/en/ci.json";
import { CiTab } from "./CiTab";

const useCiInstallations = vi.hoisted(() => vi.fn());
const exportMutate = vi.hoisted(() => vi.fn());
const archiveMutate = vi.hoisted(() => vi.fn());
const confirmMutate = vi.hoisted(() => vi.fn());
const previewMutate = vi.hoisted(() => vi.fn());
const useCiExport = vi.hoisted(() => vi.fn());
const useCiArchive = vi.hoisted(() => vi.fn());
const useConfirmCiInstallation = vi.hoisted(() => vi.fn());
const useCiPreview = vi.hoisted(() => vi.fn());

// Mock the whole hooks module — CiTab, InstallationRow, and the mounted
// ExportWizard all import from it, and this renders with no QueryClient.
vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations,
  useCiExport,
  useCiArchive,
  useConfirmCiInstallation,
  useCiPreview,
}));

const updateMutate = vi.hoisted(() => vi.fn());
const useUpdateAgent = vi.hoisted(() => vi.fn());

// FailOnControl saves through the same `useUpdateAgent` mutation as the
// Config tab — mock the module rather than the QueryClient (AC-5).
vi.mock("@/lib/hooks/agents", () => ({ useUpdateAgent }));

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function makeInstallation(overrides: Partial<CiInstallationStatus> = {}): CiInstallationStatus {
  return {
    installation: {
      id: "inst1",
      agent_id: "ag1",
      repo: "acme/payments-api",
      target_type: "gha",
      installed_at: "2026-08-20T00:00:00.000Z",
      agent_version: 1,
      base_branch: "main",
      post_as: "github_review",
      triggers: ["opened", "synchronize", "reopened"],
    },
    last_run: {
      id: "run1",
      ci_installation_id: "inst1",
      pr_number: 42,
      ran_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      status: "succeeded",
      findings_count: 0,
      cost_usd: 0.01,
      github_url: null,
      source: "gha",
      agent: "Security Reviewer",
      duration_s: 12,
      error: null,
    },
    out_of_date: false,
    ...overrides,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  exportMutate.mockReset();
  archiveMutate.mockReset();
  confirmMutate.mockReset();
  previewMutate.mockReset();
  updateMutate.mockReset();
  useCiInstallations.mockReset().mockReturnValue({ data: [], isLoading: false });
  useCiExport.mockReset().mockReturnValue({ mutate: exportMutate, isPending: false, isError: false, error: null });
  useCiArchive.mockReset().mockReturnValue({ mutate: archiveMutate, isPending: false, isError: false, error: null });
  useConfirmCiInstallation.mockReset().mockReturnValue({ mutate: confirmMutate, isPending: false });
  useCiPreview.mockReset().mockReturnValue({ mutate: previewMutate, isPending: false, isError: false, error: null });
  useUpdateAgent.mockReset().mockReturnValue({ mutate: updateMutate, isPending: false, isSuccess: false, data: undefined });
});

describe("CiTab", () => {
  it("renders one row per installation with repo, target, status and relative time, and pluralizes the repo count (AC-2, AC-3)", () => {
    useCiInstallations.mockReturnValue({
      data: [
        makeInstallation({ installation: { ...makeInstallation().installation, repo: "acme/payments-api" } }),
        makeInstallation({
          installation: { ...makeInstallation().installation, id: "inst2", repo: "acme/billing-api" },
        }),
      ],
      isLoading: false,
    });
    renderTab();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("acme/billing-api")).toBeInTheDocument();
    expect(screen.getAllByText("GitHub Actions")).toHaveLength(2);
    expect(screen.getAllByText(messages.runs.status.succeeded)).toHaveLength(2);
    expect(screen.getAllByText("5m")).toHaveLength(2);
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
  });

  it("renders the \"Skipped\" status text (not colour alone) for a skipped last run", () => {
    useCiInstallations.mockReturnValue({
      data: [makeInstallation({ last_run: { ...makeInstallation().last_run!, status: "skipped" } })],
      isLoading: false,
    });
    renderTab();

    expect(screen.getByText(messages.runs.status.skipped)).toBeInTheDocument();
  });

  it("renders the singular form for one repo (AC-3)", () => {
    useCiInstallations.mockReturnValue({ data: [makeInstallation()], isLoading: false });
    renderTab();
    expect(screen.getByText("Active in 1 repo")).toBeInTheDocument();
  });

  it("renders the empty state with no table and no badge when there are no installations (AC-4)", () => {
    useCiInstallations.mockReturnValue({ data: [], isLoading: false });
    renderTab();

    expect(screen.getByText(messages.ciTab.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.ciTab.emptyBody)).toBeInTheDocument();
    expect(screen.queryByText(messages.ciTab.table.repo)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Active in /)).not.toBeInTheDocument();
  });

  it("renders a loading skeleton (not the empty state or its CTA) while the initial fetch is in flight", () => {
    useCiInstallations.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderTab();

    expect(screen.queryByText(messages.ciTab.emptyTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.ciTab.exportToCi })).not.toBeInTheDocument();
  });

  it("renders an error state with retry (not the empty state or its CTA) when the fetch fails", () => {
    const refetch = vi.fn();
    useCiInstallations.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("boom"), refetch });
    renderTab();

    expect(screen.queryByText(messages.ciTab.emptyTitle)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders exactly four Fail CI on options naming the blocking severities and the branch-protection note (AC-6, AC-7)", () => {
    renderTab();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(4);
    expect(screen.getByRole("radio", { name: messages.ciTab.failOn.options.never })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: messages.ciTab.failOn.options.critical })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: messages.ciTab.failOn.options.warning })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: messages.ciTab.failOn.options.any })).toBeInTheDocument();
    expect(screen.getByText(messages.ciTab.branchProtectionNote)).toBeInTheDocument();
  });

  it("changing Fail CI on issues a single PATCH carrying only ci_fail_on (AC-5)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("radio", { name: messages.ciTab.failOn.options.warning }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({ id: "ag1", patch: { ci_fail_on: "warning" } });
  });

  it("renders a stale indicator and an Update control for an out-of-date installation, posting the stored fields with no workflow_override, disabled with a progress label while pending (AC-8, AC-49, AC-51, AC-56)", () => {
    useCiInstallations.mockReturnValue({ data: [makeInstallation({ out_of_date: true })], isLoading: false });
    renderTab();

    expect(screen.getByText(messages.ciTab.outOfDate)).toBeInTheDocument();
    const updateBtn = screen.getByRole("button", { name: messages.ciTab.updateAction });
    fireEvent.click(updateBtn);

    expect(exportMutate).toHaveBeenCalledTimes(1);
    const call = exportMutate.mock.calls[0]![0];
    expect(call).toEqual({
      agentId: "ag1",
      repo: "acme/payments-api",
      target: "gha",
      base: "main",
      post_as: "github_review",
      triggers: ["opened", "synchronize", "reopened"],
    });
    expect(call).not.toHaveProperty("workflow_override");

    cleanup();
    useCiExport.mockReturnValue({ mutate: exportMutate, isPending: true, isError: false, error: null });
    useCiInstallations.mockReturnValue({ data: [makeInstallation({ out_of_date: true })], isLoading: false });
    renderTab();
    const pendingBtn = screen.getByRole("button", { name: messages.ciTab.updating });
    expect(pendingBtn).toBeDisabled();
  });
});
