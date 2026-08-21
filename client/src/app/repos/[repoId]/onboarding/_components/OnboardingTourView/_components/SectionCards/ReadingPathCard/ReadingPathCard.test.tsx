import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { ReadingPathCard } from "./ReadingPathCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type ReadingPathSection = Extract<OnboardingSection, { kind: "reading_path" }>;

function section(overrides: Partial<ReadingPathSection> = {}): ReadingPathSection {
  return {
    kind: "reading_path",
    title: "Guided reading path",
    items: [
      { path: "src/server.ts", rationale: "See the whole request lifecycle in one file" },
      { path: "src/api/public/index.ts", rationale: "Understand the public contract before touching it" },
    ],
    diagram: null,
    links: null,
    empty_reason: null,
    ...overrides,
  };
}

describe("ReadingPathCard", () => {
  it("renders each step's path and rationale in contract order, numbered from 1", () => {
    renderWithIntl(<ReadingPathCard section={section()} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    expect(screen.getByText("See the whole request lifecycle in one file")).toBeInTheDocument();
  });

  it("renders the empty reason line and the card when there is no reading path (AC-11)", () => {
    const { container } = renderWithIntl(<ReadingPathCard section={section({ items: [] })} />);
    expect(container.querySelector("#reading_path")).toBeInTheDocument();
    expect(
      screen.getByText("No guided reading path was found in this repository."),
    ).toBeInTheDocument();
  });
});
