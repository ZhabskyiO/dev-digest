import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/context.json";
import { TokenBudgetBar } from "./TokenBudgetBar";

afterEach(cleanup);

function renderBar(props: Parameters<typeof TokenBudgetBar>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <TokenBudgetBar {...props} />
    </NextIntlClientProvider>,
  );
}

describe("TokenBudgetBar", () => {
  it("renders the total as an approximation against the budget (AC-9, AC-40)", () => {
    renderBar({ totalTokens: 317, budgetTokens: 12000, overBudget: false, droppedPaths: [] });
    expect(screen.getByText("≈ 317 / 12000 tokens")).toBeInTheDocument();
    expect(screen.queryByText(/won't be injected|will not be injected/)).not.toBeInTheDocument();
  });

  it("lists the dropped documents in order when over budget, disabling nothing (AC-40, AC-41)", () => {
    renderBar({
      totalTokens: 18700,
      budgetTokens: 12000,
      overBudget: true,
      droppedPaths: ["specs/rate-limiting.md", "docs/architecture.md", "insights/perf-budget.md"],
    });

    expect(screen.getByText("≈ 18700 / 12000 tokens")).toBeInTheDocument();

    const dropped = screen.getAllByText(/\.md$/).map((n) => n.textContent);
    expect(dropped).toEqual(["specs/rate-limiting.md", "docs/architecture.md", "insights/perf-budget.md"]);

    // Advisory only: the over-budget state never disables a control, and this
    // component itself renders none to disable.
    for (const el of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) {
      expect(el).not.toBeDisabled();
    }
  });
});
