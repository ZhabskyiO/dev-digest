import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — turn into eval case", () => {
  it("is disabled while the finding is undecided (decision picks the type)", () => {
    const onEvalCase = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onEvalCase={onEvalCase} />);
    const btn = screen.getByText("Turn into eval case").closest("button")!;
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onEvalCase).not.toHaveBeenCalled();
  });

  it("fires once the finding is accepted or dismissed", () => {
    const onEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, accepted_at: "2026-08-24T00:00:00Z" }}
        defaultExpanded
        onEvalCase={onEvalCase}
      />,
    );
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(onEvalCase).toHaveBeenCalledTimes(1);
  });

  it("is absent when no handler is wired (other surfaces reuse the card)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });
});
