import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentVersion } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  system_prompt: "# Role\nline two\nline three",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

let VERSIONS: AgentVersion[] = [];
const restoreMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentVersions: () => ({
    data: VERSIONS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRestoreAgentVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

vi.mock("../../../../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  VERSIONS = [];
  vi.clearAllMocks();
});

function version(over: Partial<AgentVersion> = {}): AgentVersion {
  return {
    agent_id: "ag1",
    version: 1,
    config: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      system_prompt: "# Role\nold two\nline three",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: [],
      context: [],
    },
    created_at: "2026-08-25T00:00:00Z",
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <VersionsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("VersionsTab (agent)", () => {
  it("lists versions newest-first with the head marked Current (no restore on it)", () => {
    VERSIONS = [
      version({ version: 3, config: { ...version().config, system_prompt: AGENT.system_prompt } }),
      version({ version: 1 }),
    ];
    renderTab();
    const rows = screen.getAllByTestId("agent-version-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Current")).toBeInTheDocument();
    // Only the non-current version offers Restore.
    expect(screen.getAllByText("Restore")).toHaveLength(1);
  });

  it("restores an old version through the mutation", () => {
    VERSIONS = [
      version({ version: 3, config: { ...version().config, system_prompt: AGENT.system_prompt } }),
      version({ version: 1 }),
    ];
    renderTab();
    fireEvent.click(screen.getByText("Restore"));
    expect(restoreMutate).toHaveBeenCalledTimes(1);
    expect(restoreMutate.mock.calls[0]![0]).toEqual({ agentId: "ag1", version: 1 });
  });

  it("shows a system-prompt diff for an old version on demand", () => {
    VERSIONS = [
      version({ version: 3, config: { ...version().config, system_prompt: AGENT.system_prompt } }),
      version({ version: 1 }),
    ];
    renderTab();
    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByText("v1 → current system prompt")).toBeInTheDocument();
    // v1 had "old two", current has "line two" — both sides of the change render.
    expect(screen.getByText("old two")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
  });

  it("renders the empty state when there are no snapshots", () => {
    renderTab();
    expect(
      screen.getByText("No snapshots yet — the first config edit records one."),
    ).toBeInTheDocument();
  });
});
