import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsTally } from "./FindingsTally";
import { popoverPosition, tallySeverities } from "./helpers";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "WARNING",
    category: "perf",
    title: "A finding",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop calls findMany once per user.",
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

function renderTally(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("tallySeverities", () => {
  it("counts the three contract severities and ignores anything else", () => {
    expect(
      tallySeverities([
        { severity: "CRITICAL" },
        { severity: "CRITICAL" },
        { severity: "WARNING" },
        { severity: "INFO" },
        { severity: "nonsense" },
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
  });

  it("is all-zero for no findings", () => {
    expect(tallySeverities([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe("FindingsTally", () => {
  it("shows a count per non-zero severity plus the blocker count", () => {
    renderTally(
      <FindingsTally
        findings={[
          finding({ id: "f1", severity: "CRITICAL" }),
          finding({ id: "f2", severity: "CRITICAL" }),
          finding({ id: "f3", severity: "WARNING" }),
        ]}
        blockers={2}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("falls back to the empty label when a run found nothing", () => {
    renderTally(<FindingsTally findings={[]} blockers={0} emptyLabel="0 finding(s)" />);
    expect(screen.getByText("0 finding(s)")).toBeInTheDocument();
  });

  it("opens a run-scoped hover card listing the findings", async () => {
    renderTally(
      <FindingsTally
        findings={[
          finding({ id: "f1", severity: "WARNING", title: "N+1 query in user list endpoint" }),
          finding({
            id: "f2",
            severity: "SUGGESTION",
            title: "Extract magic number 3600",
            file: "src/middleware/ratelimit.ts",
            start_line: 28,
            end_line: 28,
          }),
        ]}
      />,
    );
    fireEvent.mouseEnter(screen.getAllByText("1")[0]!);

    expect(await screen.findByText("2 findings in this run")).toBeInTheDocument();
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    // Multi-line range keeps the "45-52" form; a single-line one collapses to "28".
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts:28")).toBeInTheDocument();
  });

  it("sorts the card CRITICAL → WARNING → SUGGESTION regardless of input order", async () => {
    renderTally(
      <FindingsTally
        findings={[
          finding({ id: "f1", severity: "SUGGESTION", title: "Suggested" }),
          finding({ id: "f2", severity: "CRITICAL", title: "Critical" }),
          finding({ id: "f3", severity: "WARNING", title: "Warned" }),
        ]}
      />,
    );
    fireEvent.mouseEnter(screen.getAllByText("1")[0]!);

    const titles = await screen.findAllByText(/^(Critical|Warned|Suggested)$/);
    expect(titles.map((n) => n.textContent)).toEqual(["Critical", "Warned", "Suggested"]);
  });

  it("keeps a click inside the card off the clickable header underneath", async () => {
    let clicked = false;
    renderTally(
      // Stands in for the accordion header, which toggles open on click.
      <div onClick={() => (clicked = true)}>
        <FindingsTally findings={[finding({ id: "f1" })]} />
      </div>,
    );
    fireEvent.mouseEnter(screen.getByText("1"));
    const card = await screen.findByRole("dialog");

    fireEvent.click(card);
    expect(clicked).toBe(false);
  });
});

describe("popoverPosition", () => {
  const viewport = { viewportWidth: 1400, viewportHeight: 900 };

  it("sits below the anchor when there is room", () => {
    const { top, left } = popoverPosition({
      anchor: { top: 200, bottom: 230, left: 700 },
      cardHeight: 300,
      ...viewport,
    });
    expect(top).toBe(238);
    expect(left).toBe(700);
  });

  it("flips above the anchor for a row near the bottom of the viewport", () => {
    const { top } = popoverPosition({
      anchor: { top: 820, bottom: 850, left: 700 },
      cardHeight: 300,
      ...viewport,
    });
    expect(top).toBe(512); // 820 - 8 gap - 300 height
  });

  it("keeps a card taller than the viewport on screen", () => {
    const { top } = popoverPosition({
      anchor: { top: 820, bottom: 850, left: 700 },
      cardHeight: 2000,
      ...viewport,
    });
    expect(top).toBe(12);
  });

  it("clamps to the viewport when the anchor sits near the right edge", () => {
    const { left } = popoverPosition({
      anchor: { top: 200, bottom: 230, left: 1350 },
      cardHeight: 300,
      ...viewport,
    });
    expect(left).toBe(1400 - 490 - 12);
  });
});
