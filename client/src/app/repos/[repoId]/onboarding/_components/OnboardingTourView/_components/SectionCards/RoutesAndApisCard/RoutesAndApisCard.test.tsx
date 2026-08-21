import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { RoutesAndApisCard } from "./RoutesAndApisCard";
import { ArchitectureCard } from "../ArchitectureCard";

afterEach(cleanup);

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

type RoutesSection = Extract<OnboardingSection, { kind: "routes_and_apis" }>;

function section(overrides: Partial<RoutesSection> = {}): RoutesSection {
  return {
    kind: "routes_and_apis",
    title: "Routes & APIs",
    diagram: null,
    items: [],
    facts_unavailable: null,
    items_capped: null,
    links: null,
    empty_reason: null,
    ...overrides,
  };
}

describe("RoutesAndApisCard", () => {
  it("renders no Frontend routes heading and groups API endpoints by area when only API entries exist (AC-50)", () => {
    renderWithIntl(
      <RoutesAndApisCard
        section={section({
          items: [
            {
              surface: "api",
              group: "agents",
              method: "GET",
              route: "/agents",
              source_path: "src/api/agents/index.ts",
              note: null,
            },
            {
              surface: "api",
              group: "pulls",
              method: "POST",
              route: "/pulls/:number/review",
              source_path: "src/api/pulls/review.ts",
              note: null,
            },
          ],
        })}
      />,
    );
    expect(screen.queryByText("Frontend routes")).not.toBeInTheDocument();
    expect(screen.getByText("API endpoints")).toBeInTheDocument();
    expect(screen.getByText("agents")).toBeInTheDocument();
    expect(screen.getByText("pulls")).toBeInTheDocument();
    expect(screen.getByText("/agents")).toBeInTheDocument();
    expect(screen.getByText("/pulls/:number/review")).toBeInTheDocument();
  });

  it("renders both surfaces when a repository exposes both", () => {
    renderWithIntl(
      <RoutesAndApisCard
        section={section({
          items: [
            {
              surface: "frontend",
              group: "app",
              method: null,
              route: "/repos/:repoId/pulls",
              source_path: "src/app/repos/[repoId]/pulls/page.tsx",
              note: null,
            },
            {
              surface: "api",
              group: "agents",
              method: "GET",
              route: "/agents",
              source_path: "src/api/agents/index.ts",
              note: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Frontend routes")).toBeInTheDocument();
    expect(screen.getByText("API endpoints")).toBeInTheDocument();
  });

  it("renders the facts_unavailable and items_capped notices", () => {
    renderWithIntl(
      <RoutesAndApisCard
        section={section({
          items: [
            {
              surface: "api",
              group: "agents",
              method: "GET",
              route: "/agents",
              source_path: "src/api/agents/index.ts",
              note: null,
            },
          ],
          facts_unavailable: true,
          items_capped: true,
        })}
      />,
    );
    expect(
      screen.getByText(
        "The index has no extracted endpoint facts for this repository, so entries are shown on file evidence alone.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing only the first matches found in this repository.")).toBeInTheDocument();
  });

  it("renders the empty reason line and the card when there are no entries (AC-11)", () => {
    const { container } = renderWithIntl(<RoutesAndApisCard section={section()} />);
    expect(container.querySelector("#routes_and_apis")).toBeInTheDocument();
    expect(
      screen.getByText("No frontend routes or API endpoints were found in this repository."),
    ).toBeInTheDocument();
  });

  it("an invalid diagram on this section does not suppress a sibling valid architecture diagram (AC-14)", async () => {
    const { container } = renderWithIntl(
      <div>
        <ArchitectureCard
          section={{
            kind: "architecture",
            title: "Architecture",
            body: "Overview.",
            diagram: "flowchart LR\n A-->B",
            links: null,
          }}
        />
        <RoutesAndApisCard
          section={section({
            diagram: "not a real diagram",
            items: [
              {
                surface: "api",
                group: "agents",
                method: "GET",
                route: "/agents",
                source_path: "src/api/agents/index.ts",
                note: null,
              },
            ],
          })}
        />
      </div>,
    );
    // Icons in each card's frame are ALSO <svg> — assert on the mermaid
    // mock's own marker, not "any svg", so icon svgs can't false-positive it.
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="mock-svg"]').length).toBe(1),
    );
  });
});
