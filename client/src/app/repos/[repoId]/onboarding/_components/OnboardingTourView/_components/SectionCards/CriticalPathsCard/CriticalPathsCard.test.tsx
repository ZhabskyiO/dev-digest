import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { CriticalPathsCard } from "./CriticalPathsCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type CriticalPathsSection = Extract<OnboardingSection, { kind: "critical_paths" }>;

function section(overrides: Partial<CriticalPathsSection> = {}): CriticalPathsSection {
  return {
    kind: "critical_paths",
    title: "Critical paths",
    items: [{ path: "src/lib/redis.ts", why: "Shared Redis singleton — reuse this" }],
    diagram: null,
    links: null,
    empty_reason: null,
    ...overrides,
  };
}

describe("CriticalPathsCard", () => {
  it("targets the provider blob URL at the recorded revision, with rel=noopener noreferrer (AC-39)", () => {
    renderWithIntl(
      <CriticalPathsCard
        section={section()}
        repoFullName="acme/payments-api"
        revision="abc123def"
        defaultBranch="main"
      />,
    );
    const link = screen.getByRole("link", { name: /src\/lib\/redis\.ts/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123def/src/lib/redis.ts",
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to the default branch when no revision was recorded (AC-39)", () => {
    renderWithIntl(
      <CriticalPathsCard
        section={section()}
        repoFullName="acme/payments-api"
        revision={null}
        defaultBranch="main"
      />,
    );
    const link = screen.getByRole("link", { name: /src\/lib\/redis\.ts/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/lib/redis.ts",
    );
  });

  it("gives the Open control an accessible name naming its target (AC-47)", () => {
    renderWithIntl(
      <CriticalPathsCard
        section={section()}
        repoFullName="acme/payments-api"
        revision="abc123def"
        defaultBranch="main"
      />,
    );
    expect(screen.getByRole("link", { name: "Open src/lib/redis.ts on GitHub" })).toBeInTheDocument();
  });

  it("renders the empty reason line and the card when there are no items (AC-11)", () => {
    const { container } = renderWithIntl(
      <CriticalPathsCard section={section({ items: [] })} repoFullName={null} revision={null} defaultBranch={null} />,
    );
    expect(container.querySelector("#critical_paths")).toBeInTheDocument();
    expect(
      screen.getByText("No critical paths were found in this repository."),
    ).toBeInTheDocument();
  });
});
