import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const realRaf = window.requestAnimationFrame;
const realCancelRaf = window.cancelAnimationFrame;
afterEach(() => {
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancelRaf;
});

/**
 * Run rAF callbacks synchronously, but only `maxFrames` of them. The panel's
 * scroll-settle loop reschedules itself until its deadline, so an unbounded
 * synchronous stub recurses forever.
 */
function stubRaf(maxFrames = 2) {
  let frames = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (frames++ < maxFrames) cb(frames);
    return frames;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
}

const LOW_CONF: FindingRecord = {
  id: "f2",
  severity: "SUGGESTION",
  category: "style",
  title: "Prefer const over let",
  file: "src/util.ts",
  start_line: 4,
  end_line: 4,
  rationale: "…",
  suggestion: null,
  // Below LOW_CONFIDENCE_THRESHOLD, so "hide low confidence" filters it out.
  confidence: 0.2,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

/** A second CRITICAL, so a chip click has somewhere to advance to. */
const SECOND_CRITICAL: FindingRecord = {
  ...FINDINGS[0]!,
  id: "f3",
  title: "Unbounded query",
  file: "src/db.ts",
  rationale: "The query has no limit.",
};

/** Replace `scrollIntoView` with a spy that records which card it scrolled to. */
function spyScrollTargets(): string[] {
  const targets: string[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    targets.push(this.getAttribute("data-finding-id") ?? "");
  }) as typeof Element.prototype.scrollIntoView;
  return targets;
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("shows a chip per non-zero severity, and none for a severity with no findings", () => {
    renderWithIntl(<FindingsPanel findings={[LOW_CONF, ...FINDINGS]} prId="pr1" />);
    expect(screen.getByText(/1 Critical/)).toBeInTheDocument();
    expect(screen.getByText(/1 Suggestion/)).toBeInTheDocument();
    // No WARNING findings here — the absent chip is the message, not "0 Warning".
    expect(screen.queryByText(/Warning/)).not.toBeInTheDocument();
  });

  it("counts describe the visible list, so hiding low confidence moves them", () => {
    renderWithIntl(<FindingsPanel findings={[LOW_CONF, ...FINDINGS]} prId="pr1" />);
    expect(screen.getByText(/1 Suggestion/)).toBeInTheDocument();

    // The low-confidence SUGGESTION is filtered out, so its chip goes with it.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText(/Suggestion/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 Critical/)).toBeInTheDocument();
  });

  it("scrolls to a severity's findings when its chip is clicked, cycling on repeat clicks", () => {
    const targets = spyScrollTargets();
    renderWithIntl(
      <FindingsPanel findings={[LOW_CONF, ...FINDINGS, SECOND_CRITICAL]} prId="pr1" />,
    );

    const critical = screen.getByRole("button", { name: /2 Critical/ });
    // Focus starts on the first card, so the first click advances past it —
    // then wraps back rather than dead-ending at the bottom of the block.
    fireEvent.click(critical);
    fireEvent.click(critical);
    expect(targets).toEqual(["f3", "f1"]);

    // A different chip jumps to its own severity, not to the next card.
    fireEvent.click(screen.getByRole("button", { name: /1 Suggestion/ }));
    expect(targets.at(-1)).toBe("f2");
  });

  it("expands and scrolls to a deep-linked target finding", () => {
    // jsdom implements neither; the panel calls both when revealing a target.
    Element.prototype.scrollIntoView = vi.fn();
    stubRaf();

    renderWithIntl(
      <FindingsPanel findings={[LOW_CONF, ...FINDINGS]} prId="pr1" targetFindingId="f1" />,
    );

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    // The card body only renders when expanded — the target must be open even
    // though it is not the first card in the list.
    expect(screen.getByText("A secret is committed.")).toBeInTheDocument();
  });

  it("un-hides a low-confidence finding rather than dead-ending on the link", () => {
    Element.prototype.scrollIntoView = vi.fn();
    stubRaf();

    const { rerender } = renderWithIntl(
      <FindingsPanel findings={[LOW_CONF]} prId="pr1" targetFindingId="f2" />,
    );
    // Even with the filter on, arriving from a diff badge must land on the card
    // rather than an empty list.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={[LOW_CONF]} prId="pr1" targetFindingId="f2" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Prefer const over let")).toBeInTheDocument();
  });
});
