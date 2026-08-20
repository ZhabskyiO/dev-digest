/* /agents/:id — URL wiring only (which `?tab=` the editor is handed).
   The tab CONTENT is covered by AgentEditor.test.tsx; this suite exists
   because the page owns the `?tab=` allowlist, and an allowlist that drifts
   from the tab bar produces a tab that visibly bounces back to Config. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../messages/en/agents.json";

// The real allowlist, imported through `vi.hoisted` so the mock below can hand
// back the GENUINE keys. Restating them as a literal here is exactly how the
// production bug happened, and it would make this suite pass while the app
// stayed broken.
const constants = await vi.hoisted(
  async () => await import("./_components/AgentEditor/constants"),
);

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

vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [AGENT] }),
  useAgent: () => ({ data: AGENT, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentStats: () => ({ data: undefined }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
  // Reached through AgentCard in the left rail, not by the page itself.
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../lib/hooks/skills", () => ({
  useAgentSkills: () => ({ data: [] }),
}));

// The editor pulls in CodeMirror through ConfigTab — irrelevant here, so it is
// swapped for a probe that just reports which tab it was handed. The tab
// constants are passed through unchanged (see `constants` above).
vi.mock("./_components/AgentEditor", () => ({
  AgentEditor: ({ agent, tab }: { agent: Agent; tab: string }) => (
    <div data-testid="agent-editor">{`${agent.name}:${tab}`}</div>
  ),
  TAB_KEYS: constants.TAB_KEYS,
  DEFAULT_TAB: constants.DEFAULT_TAB,
}));

vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const push = vi.fn();
const replace = vi.fn();
let searchParamsValue = "";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "ag1" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

import AgentEditorPage from "./page";

afterEach(() => {
  cleanup();
  searchParamsValue = "";
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <AgentEditorPage />
    </NextIntlClientProvider>,
  );
}

describe("AgentEditorPage — ?tab= wiring", () => {
  it("honours ?tab=context instead of falling back to config", () => {
    searchParamsValue = "tab=context";
    renderPage();
    expect(screen.getByTestId("agent-editor")).toHaveTextContent("Security Reviewer:context");
  });

  it("accepts every tab the tab bar renders", () => {
    for (const key of constants.TAB_KEYS) {
      searchParamsValue = `tab=${key}`;
      renderPage();
      expect(screen.getByTestId("agent-editor")).toHaveTextContent(`Security Reviewer:${key}`);
      cleanup();
    }
  });

  it("defaults to config when ?tab= is absent", () => {
    renderPage();
    expect(screen.getByTestId("agent-editor")).toHaveTextContent("Security Reviewer:config");
  });

  it("falls back to config for a ?tab= that isn't a real tab", () => {
    searchParamsValue = "tab=nonsense";
    renderPage();
    expect(screen.getByTestId("agent-editor")).toHaveTextContent("Security Reviewer:config");
  });
});
