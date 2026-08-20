import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// Mutable so individual tests can swap in a trace shaped differently
// (e.g. one with `prompt_assembly.specs` set) without a second render module.
let mockTrace: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: mockTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  mockTrace = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  it("AC-31: labels the attached-specs prompt-assembly slot as untrusted", () => {
    // The i18n string under test lives only in messages/en/runs.json
    // (trace.prompt.specs) — deliberately not spelled out here so this
    // fixture can't stand in for the source-of-truth label copy.
    mockTrace = {
      ...TRACE,
      prompt_assembly: { ...TRACE.prompt_assembly, specs: "<untrusted>...</untrusted>" },
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    // Prompt assembly section is collapsed by default — open it first.
    fireEvent.click(screen.getByText("Prompt assembly"));
    const label = screen.getByText(/attached specs/i);
    expect(label.textContent).toMatch(/untrusted/i);
  });

  it("AC-32: omits the attached-specs slot when prompt_assembly.specs is null", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    // TRACE.prompt_assembly.specs is null — no "untrusted" prompt-assembly row.
    expect(screen.queryByText(/untrusted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attached specs/i)).not.toBeInTheDocument();
  });

  it("AC-33: renders a legacy trace lacking project_context without throwing", () => {
    // TRACE has neither `project_context` nor a `prompt_assembly.specs` value —
    // exactly the shape of a trace persisted before this feature (AC-33).
    expect(() =>
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />),
    ).not.toThrow();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    // No project-context configuration row either, since the field is absent.
    expect(screen.queryByText(/project context/i)).not.toBeInTheDocument();
  });
});
