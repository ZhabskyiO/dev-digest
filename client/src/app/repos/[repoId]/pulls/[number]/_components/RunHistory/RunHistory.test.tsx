/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "WARNING",
    category: "perf",
    title: "A finding",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "Because reasons.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRun?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — per-run findings breakdown", () => {
  const withFindings = new Map<string, FindingRecord[]>([
    [
      "run-1",
      [
        finding({ id: "f1", severity: "CRITICAL", title: "Hardcoded Stripe secret key" }),
        finding({ id: "f2", severity: "CRITICAL" }),
        finding({ id: "f3", severity: "WARNING", title: "N+1 query in user list endpoint" }),
      ],
    ],
  ]);

  it("replaces the plain count with a severity breakdown, keeping the blocker count", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], withFindings);
    expect(screen.queryByText("3 finding(s)")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // 2 CRITICAL
    expect(screen.getByText("1")).toBeInTheDocument(); // 1 WARNING
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("opens a run-scoped hover card on the breakdown", async () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], withFindings);
    fireEvent.mouseEnter(screen.getByText("2"));

    expect(await screen.findByText("3 findings in this run")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
  });

  it("falls back to the denormalized count when the run's findings aren't loaded", () => {
    // A run whose review was deleted has no entry in the map.
    renderRuns([run({ status: "done", findings_count: 3, blockers: 2, score: 38 })], new Map());
    expect(screen.getByText(/3 finding\(s\)/)).toBeInTheDocument();
  });

  it("still reads '0 finding(s)' for a clean run", () => {
    renderRuns(
      [run({ status: "done", findings_count: 0, blockers: 0, score: 100 })],
      new Map([["run-1", []]]),
    );
    expect(screen.getByText("0 finding(s)")).toBeInTheDocument();
  });
});
