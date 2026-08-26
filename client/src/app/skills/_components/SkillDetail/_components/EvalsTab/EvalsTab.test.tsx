import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseSummary, Skill } from "@devdigest/shared";
import evalMessages from "../../../../../../../messages/en/eval.json";

const SKILL: Skill = {
  id: "sk1",
  name: "breaking-change",
  description: "",
  type: "rubric",
  source: "manual",
  body: "…",
  enabled: true,
  version: 3,
};

const CASES: EvalCaseSummary[] = [
  {
    id: "c1",
    agent_id: "sk1",
    owner_kind: "skill",
    name: "breaking-change-gate-field-removal-is-flagged",
    input_diff: "diff --git a/api.ts b/api.ts",
    expectation: { type: "must_find", file: "api.ts", start_line: 3, end_line: 6, severity: "CRITICAL", category: "security" },
    notes: null,
    meta: null,
    last_run: {
      run_id: "r1",
      ran_at: "2026-08-24T10:00:00Z",
      pass: false,
      findings_count: 0,
      matched: 0,
      baseline_pass: true,
    },
  },
  {
    id: "c2",
    agent_id: "sk1",
    owner_kind: "skill",
    name: "additive-optional-field-not-flagged",
    input_diff: "diff --git a/api.ts b/api.ts",
    expectation: { type: "must_not_flag", file: "api.ts", start_line: 10, end_line: 12 },
    notes: null,
    meta: null,
    last_run: null,
  },
];

const runAllMutate = vi.fn();

vi.mock("../../../../../../lib/hooks/evals", () => ({
  useSkillEvalCases: () => ({ data: CASES, isLoading: false }),
  useRunSkillEvals: () => ({ mutate: runAllMutate, isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("Skill EvalsTab", () => {
  it("lists the skill's cases with expectation badges and the with/without lift", () => {
    renderTab();
    expect(screen.getAllByTestId("skill-eval-case-row")).toHaveLength(2);
    expect(screen.getByText("must find")).toBeInTheDocument();
    expect(screen.getByText("must not flag")).toBeInTheDocument();
    // failed with the skill, passed without → the lift line makes that visible
    expect(screen.getByText(/With skill 0% \/ Without skill 100%/)).toBeInTheDocument();
    expect(screen.getByText(/expected 1 finding, got 0/)).toBeInTheDocument();
    expect(screen.getByText("CRITICAL · security")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("runs the whole set as the with/without benchmark", () => {
    renderTab();
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runAllMutate).toHaveBeenCalledTimes(1);
  });

  it("opens the shared case editor for a new skill-owned case", () => {
    renderTab();
    fireEvent.click(screen.getByText("New eval case"));
    expect(screen.getByText("Finding skeleton")).toBeInTheDocument();
  });
});
