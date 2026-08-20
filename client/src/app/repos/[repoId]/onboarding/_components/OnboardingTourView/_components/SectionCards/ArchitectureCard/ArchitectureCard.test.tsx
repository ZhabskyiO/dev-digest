import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { ArchitectureCard } from "./ArchitectureCard";

afterEach(cleanup);

// Deterministic, fast stand-in for the real mermaid engine — real mermaid
// rendering in jsdom is unnecessary here: MermaidDiagram's own job (parse
// before render, null on invalid input) is already covered by its own
// component; this only needs to prove ArchitectureCard *uses* it (AC-14).
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue(true),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mock-svg"></svg>' }),
  },
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type ArchitectureSection = Extract<OnboardingSection, { kind: "architecture" }>;

function architectureSection(overrides: Partial<ArchitectureSection> = {}): ArchitectureSection {
  return {
    kind: "architecture",
    title: "Architecture",
    body: "**payments-api** is a Node service.",
    diagram: null,
    links: null,
    ...overrides,
  };
}

describe("ArchitectureCard", () => {
  it("renders model-written markdown without executing embedded HTML/scripts (AC-43)", () => {
    const { container } = renderWithIntl(
      <ArchitectureCard section={architectureSection({ body: "<script>alert(1)</script>" })} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });

  it("renders a valid diagram (AC-14)", async () => {
    const { container } = renderWithIntl(
      <ArchitectureCard section={architectureSection({ diagram: "flowchart LR\n A-->B" })} />,
    );
    // Icons in the card frame are ALSO <svg> — assert on the mermaid mock's
    // own marker, not on "any svg", so the icon svgs can't false-positive it.
    await waitFor(() => expect(container.querySelector('[data-testid="mock-svg"]')).toBeInTheDocument());
  });

  it("renders its body with no diagram box when the diagram is invalid, independently of other sections (AC-14)", () => {
    const { container } = renderWithIntl(
      <ArchitectureCard
        section={architectureSection({ body: "Body text stays.", diagram: "not a real diagram" })}
      />,
    );
    expect(screen.getByText("Body text stays.")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="mock-svg"]')).toBeNull();
  });

  it("renders the empty reason line when the body is blank (AC-11)", () => {
    renderWithIntl(<ArchitectureCard section={architectureSection({ body: "" })} />);
    expect(
      screen.getByText("No architecture overview was found in this repository."),
    ).toBeInTheDocument();
  });

  it("never renders a model-written markdown link as a live <a> (M6)", () => {
    const { container } = renderWithIntl(
      <ArchitectureCard
        section={architectureSection({
          body: "See [click me](https://attacker.example) for docs.",
        })}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/click me/)).toBeInTheDocument();
  });
});
