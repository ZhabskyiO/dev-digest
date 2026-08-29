import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import ciMessages from "../../../../../../messages/en/ci.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// CiTab (mounted only on tab === "ci") pulls in `lib/hooks/ci` — without this
// mock its `useQuery`/`useMutation` calls blow up with "No QueryClient set"
// since these tests render without a provider (client/insights/gotchas.md).
vi.mock("../../../../../lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: [], isLoading: false }),
  useCiExport: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useCiArchive: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useConfirmCiInstallation: () => ({ mutate: vi.fn(), isPending: false }),
  useCiPreview: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { AgentEditor } from "./AgentEditor";

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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, ci: ciMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders the CI panel for ?tab=ci and marks the CI tab active (AC-1)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="ci" onTab={() => {}} />);
    expect(screen.getByText(ciMessages.ciTab.heading)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.ciTab.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CI" })).toHaveStyle({ fontWeight: 600 });
  });

  it("falls back to the Config tab for an unknown ?tab= value (AC-1)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="not-a-real-tab" onTab={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.queryByText(ciMessages.ciTab.heading)).not.toBeInTheDocument();
  });
});
