import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalBatch, EvalCaseSummary } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 7,
};

const CASES: EvalCaseSummary[] = [
  {
    id: "c1",
    agent_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "diff --git a/src/config.ts b/src/config.ts",
    expectation: { type: "must_find", file: "src/config.ts", start_line: 12, end_line: 12 },
    notes: null,
    meta: null,
    last_run: { run_id: "r1", ran_at: "2026-08-24T10:00:00Z", pass: true, findings_count: 1 },
  },
  {
    id: "c2",
    agent_id: "ag1",
    name: "clean-refactor-no-flags",
    input_diff: "diff --git a/src/utils.ts b/src/utils.ts",
    expectation: { type: "must_not_flag", file: "src/utils.ts", start_line: 1, end_line: 3 },
    notes: null,
    meta: null,
    last_run: null,
  },
];

function batch(over: Partial<EvalBatch>): EvalBatch {
  return {
    batch_id: "b1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    agent_version: 7,
    model: "gpt-4.1",
    provider: "openai",
    ran_at: "2026-08-24T10:00:00Z",
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    passed: 17,
    total: 20,
    duration_ms: 4200,
    cost_usd: 0.23,
    ...over,
  };
}

const RUNS: EvalBatch[] = [
  batch({}),
  batch({ batch_id: "b0", agent_version: 6, ran_at: "2026-08-23T10:00:00Z", recall: 0.78, passed: 16 }),
];

const runMutate = vi.fn();
const runOneMutate = vi.fn();
const deleteMutate = vi.fn();
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

const runOneState = vi.hoisted(() => ({ isPending: false, variables: undefined as { caseId: string } | undefined }));

vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: CASES, isLoading: false }),
  useEvalRuns: () => ({ data: RUNS, isLoading: false }),
  useRunEvals: () => ({ mutate: runMutate, isPending: false }),
  useRunEvalCase: () => ({ mutate: runOneMutate, isPending: runOneState.isPending, variables: runOneState.variables }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  runOneState.isPending = false;
  runOneState.variables = undefined;
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("shows latest-batch metric tiles and the traces tile", () => {
    renderTab();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument(); // recall %
    expect(screen.getByText("91")).toBeInTheDocument(); // precision %
    expect(screen.getByText("95")).toBeInTheDocument(); // citation %
    expect(screen.getAllByText("17/20").length).toBeGreaterThan(0);
  });

  it("lists cases with expectation type and last-run status", () => {
    renderTab();
    const rows = screen.getAllByTestId("eval-case-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("must find")).toBeInTheDocument();
    expect(screen.getByText("must not flag")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 passing")).toBeInTheDocument();
  });

  it("swaps the play button for a running indicator on the in-flight case only", () => {
    runOneState.isPending = true;
    runOneState.variables = { caseId: "c1" };
    renderTab();
    expect(screen.getByTestId("case-running")).toBeInTheDocument();
    // the other case keeps its play button
    expect(screen.getAllByLabelText("Run")).toHaveLength(1);
  });

  it("runs the whole set from the Run all evals button", () => {
    renderTab();
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runMutate).toHaveBeenCalledTimes(1);
  });

  it("renders the metric trend chart when at least two runs exist", () => {
    renderTab();
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    expect(screen.getByTestId("eval-trend-chart")).toBeInTheDocument();
  });

  it("shows New eval case, per-case play/edit, and the dashboard link", () => {
    renderTab();
    // + New eval case opens the case editor modal (design-mock layout)
    fireEvent.click(screen.getByText("New case"));
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText("Run on save")).toBeInTheDocument();
    expect(screen.getByText("PR meta")).toBeInTheDocument();
    // Finding skeleton fills the expected-output JSON panel
    fireEvent.click(screen.getByText("Finding skeleton"));
    expect((screen.getByTestId("expected-json") as HTMLTextAreaElement).value).toContain('"must_find"');
    fireEvent.click(screen.getByText("Cancel"));

    // per-case play triggers a single-case run
    fireEvent.click(screen.getAllByLabelText("Run")[0]!);
    expect(runOneMutate).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "c1" }),
      expect.anything(),
    );

    // per-case edit opens the editor prefilled, diff shown as coloured preview
    fireEvent.click(screen.getAllByLabelText("Edit")[0]!);
    expect(screen.getByText("Eval case · stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByTestId("diff-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));

    // View full dashboard → navigates to /evals
    fireEvent.click(screen.getByText("View full dashboard →"));
    expect(routerPush).toHaveBeenCalledWith("/evals");
  });

  it("enables Compare only after selecting two runs, then shows the deltas modal", () => {
    renderTab();
    const compare = screen.getByText("Compare").closest("button")!;
    expect(compare).toBeDisabled();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(compare).not.toBeDisabled();

    fireEvent.click(compare);
    // old (v6) → new (v7), regardless of click order
    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();
    expect(screen.getByText("▲ 4pt")).toBeInTheDocument(); // recall 78 → 82
  });
});
