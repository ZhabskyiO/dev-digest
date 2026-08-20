import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { FirstTasksCard } from "./FirstTasksCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type FirstTasksSection = Extract<OnboardingSection, { kind: "first_tasks" }>;

function section(overrides: Partial<FirstTasksSection> = {}): FirstTasksSection {
  return {
    kind: "first_tasks",
    title: "First tasks",
    items: [
      { title: "Add a /health readiness probe", target: "src/api/public/health.ts", complexity: "low" },
      { title: "Backfill tests for the rate limiter", target: "test/ratelimit.test.ts", complexity: "medium" },
      { title: "Document the webhook signature flow", target: "specs/", complexity: "high" },
    ],
    diagram: null,
    links: null,
    empty_reason: null,
    ...overrides,
  };
}

describe("FirstTasksCard", () => {
  it("conveys complexity through badge text containing the word 'complexity' for every level (AC-46)", () => {
    renderWithIntl(<FirstTasksCard section={section()} />);
    expect(screen.getByText("Low complexity")).toBeInTheDocument();
    expect(screen.getByText("Medium complexity")).toBeInTheDocument();
    expect(screen.getByText("High complexity")).toBeInTheDocument();
  });

  it("renders a target that is an existing directory just like a file target (AC-23)", () => {
    renderWithIntl(<FirstTasksCard section={section()} />);
    expect(screen.getByText("specs/")).toBeInTheDocument();
  });

  it("renders the empty reason line and the card when there are no first tasks (AC-11)", () => {
    const { container } = renderWithIntl(<FirstTasksCard section={section({ items: [] })} />);
    expect(container.querySelector("#first_tasks")).toBeInTheDocument();
    expect(
      screen.getByText("No first tasks were found in this repository."),
    ).toBeInTheDocument();
  });
});
