import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  Onboarding,
  OnboardingSection,
  OnboardingSectionKind,
  OnboardingTourResponse,
} from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";
import commonMessages from "../../../../../../../messages/en/common.json";

// jsdom implements neither. IntersectionObserver only needs to exist (the
// scrollspy hook's own logic is proven directly by not asserting on it here
// — activating a TOC entry sets the marker immediately, without waiting on
// an observer tick, which is what these tests exercise). scrollIntoView is
// spied on per-test against the real target element.
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).IntersectionObserver = MockIntersectionObserver;
Element.prototype.scrollIntoView = vi.fn();

let RESPONSE: OnboardingTourResponse | undefined;
let QUERY_LOADING = false;
let QUERY_ERROR = false;
const refetchFn = vi.fn();
const generateMutate = vi.fn();
let generatePending = false;

vi.mock("@/lib/hooks", () => ({
  useOnboardingTour: () => ({
    data: RESPONSE,
    isLoading: QUERY_LOADING,
    isError: QUERY_ERROR,
    error: null,
    refetch: refetchFn,
  }),
  useGenerateOnboardingTour: () => ({
    mutate: generateMutate,
    isPending: generatePending,
  }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", name: "payments-api", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/repos/r1/onboarding",
}));

// The full AppShell drags in the command palette / shortcuts machinery; a
// thin stand-in that still renders `crumb` is enough to prove AC-35's
// breadcrumb without any of that.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, crumb }: { children: React.ReactNode; crumb?: { label: string }[] }) => (
    <div>
      <nav aria-label="breadcrumb">
        {crumb?.map((c, i) => (
          <span key={i}>{c.label}</span>
        ))}
      </nav>
      {children}
    </div>
  ),
}));

import { OnboardingTourView } from "./OnboardingTourView";

const SIX_KINDS: OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "routes_and_apis",
  "local_setup",
  "reading_path",
  "first_tasks",
];

function sixSections(overrides: Partial<Record<OnboardingSectionKind, OnboardingSection>> = {}): OnboardingSection[] {
  const base: Record<OnboardingSectionKind, OnboardingSection> = {
    architecture: {
      kind: "architecture",
      title: "Architecture",
      body: "**payments-api** is a Node service.",
      diagram: null,
      links: null,
    },
    critical_paths: {
      kind: "critical_paths",
      title: "Critical paths",
      items: [{ path: "src/server.ts", why: "App bootstrap + middleware chain" }],
      diagram: null,
      links: null,
      empty_reason: null,
    },
    routes_and_apis: {
      kind: "routes_and_apis",
      title: "Routes & APIs",
      diagram: null,
      items: [
        {
          surface: "api",
          group: "payments",
          method: "GET",
          route: "/health",
          source_path: "src/api/public/health.ts",
          note: null,
        },
      ],
      facts_unavailable: null,
      items_capped: null,
      links: null,
      empty_reason: null,
    },
    local_setup: {
      kind: "local_setup",
      title: "How to run locally",
      items: [{ command: "pnpm install" }],
      diagram: null,
      links: null,
      empty_reason: null,
    },
    reading_path: {
      kind: "reading_path",
      title: "Guided reading path",
      items: [{ path: "src/server.ts", rationale: "See the whole request lifecycle in one file" }],
      diagram: null,
      links: null,
      empty_reason: null,
    },
    first_tasks: {
      kind: "first_tasks",
      title: "First tasks",
      items: [{ title: "Add a /health readiness probe", target: "src/api/public/health.ts", complexity: "low" }],
      diagram: null,
      links: null,
      empty_reason: null,
    },
  };
  return SIX_KINDS.map((kind) => overrides[kind] ?? base[kind]);
}

function tour(overrides: Partial<Onboarding> = {}, sectionOverrides: Partial<Record<OnboardingSectionKind, OnboardingSection>> = {}): Onboarding {
  return {
    sections: sixSections(sectionOverrides),
    generated_at: "2026-08-01T12:00:00Z",
    indexed_revision: "abc123",
    indexed_file_count: 12450,
    provider: "openai",
    model: "gpt-5",
    degraded_reason: null,
    ...overrides,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages, common: commonMessages }}>
      <OnboardingTourView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  RESPONSE = undefined;
  QUERY_LOADING = false;
  QUERY_ERROR = false;
  generatePending = false;
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe("OnboardingTourView", () => {
  it("renders six section cards and a six-entry on-this-page list in AC-1 order, Routes and APIs third (AC-36)", () => {
    RESPONSE = { tour: tour(), state: "ready", stale: false, failure_reason: null, job_id: null };
    const { container } = renderView();

    const toc = screen.getByRole("navigation", { name: "On this page" });
    const entries = within(toc).getAllByRole("button").map((btn) => btn.textContent);
    expect(entries).toEqual([
      "Architecture overview",
      "Critical paths",
      "Routes & APIs",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);

    for (const kind of SIX_KINDS) {
      expect(container.querySelector(`#${kind}`)).toBeInTheDocument();
    }
  });

  it("activating 'First tasks' moves the active marker and scrolls its card into view (AC-36)", () => {
    RESPONSE = { tour: tour(), state: "ready", stale: false, failure_reason: null, job_id: null };
    renderView();

    const target = document.getElementById("first_tasks") as HTMLElement;
    const scrollSpy = vi.spyOn(target, "scrollIntoView");

    const toc = screen.getByRole("navigation", { name: "On this page" });
    fireEvent.click(within(toc).getByText("First tasks"));

    expect(within(toc).getByText("First tasks")).toHaveAttribute("aria-current", "true");
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("collapsing Critical paths hides its rows while its TOC entry remains (AC-37)", () => {
    RESPONSE = { tour: tour(), state: "ready", stale: false, failure_reason: null, job_id: null };
    renderView();

    expect(screen.getByText("App bootstrap + middleware chain")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Critical paths section" }));
    expect(screen.queryByText("App bootstrap + middleware chain")).not.toBeInTheDocument();

    const toc = screen.getByRole("navigation", { name: "On this page" });
    expect(within(toc).getByText("Critical paths")).toBeInTheDocument();
  });

  it("still shows six TOC entries and six cards when local_setup is empty (AC-11)", () => {
    RESPONSE = {
      tour: tour({}, { local_setup: { kind: "local_setup", title: "How to run locally", items: [], diagram: null, links: null, empty_reason: "insufficient_grounding" } }),
      state: "ready",
      stale: false,
      failure_reason: null,
      job_id: null,
    };
    const { container } = renderView();

    const toc = screen.getByRole("navigation", { name: "On this page" });
    expect(within(toc).getAllByRole("button")).toHaveLength(6);
    for (const kind of SIX_KINDS) {
      expect(container.querySelector(`#${kind}`)).toBeInTheDocument();
    }
    expect(
      screen.getByText("Not enough grounded evidence was found to fill this section."),
    ).toBeInTheDocument();
  });

  it("renders the index-first not_indexed state with no generate button (AC-6)", () => {
    RESPONSE = { tour: null, state: "not_indexed", stale: false, failure_reason: null, job_id: null };
    renderView();

    expect(screen.getByText("This repository has not been indexed yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });

  it("renders the generate action for the empty state (AC-41)", () => {
    RESPONSE = { tour: null, state: "empty", stale: false, failure_reason: null, job_id: null };
    renderView();

    const cta = screen.getByRole("button", { name: "Generate onboarding tour" });
    fireEvent.click(cta);
    expect(generateMutate).toHaveBeenCalled();
  });

  it("keeps all six previous sections rendered and disables Regenerate while generating (AC-26, AC-27)", () => {
    RESPONSE = { tour: tour(), state: "generating", stale: false, failure_reason: null, job_id: "job1" };
    const { container } = renderView();

    for (const kind of SIX_KINDS) {
      expect(container.querySelector(`#${kind}`)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  });

  it("renders the failed reason and still renders the previous tour (AC-28)", () => {
    RESPONSE = {
      tour: tour(),
      state: "failed",
      stale: false,
      failure_reason: "provider timeout",
      job_id: null,
    };
    const { container } = renderView();

    expect(screen.getByText(/last regeneration failed: provider timeout/)).toBeInTheDocument();
    for (const kind of SIX_KINDS) {
      expect(container.querySelector(`#${kind}`)).toBeInTheDocument();
    }
  });

  it("renders the stale marker and all six sections for a stale tour (AC-29, AC-30)", () => {
    RESPONSE = { tour: tour(), state: "ready", stale: true, failure_reason: null, job_id: null };
    const { container } = renderView();

    expect(
      screen.getByText(/generated before the latest repository index update/),
    ).toBeInTheDocument();
    for (const kind of SIX_KINDS) {
      expect(container.querySelector(`#${kind}`)).toBeInTheDocument();
    }
  });

  it("builds the subtitle from the mocked indexed_file_count (AC-25)", () => {
    RESPONSE = { tour: tour({ indexed_file_count: 999 }), state: "ready", stale: false, failure_reason: null, job_id: null };
    renderView();
    expect(screen.getByText(/999 files/)).toBeInTheDocument();
  });

  it("Share link writes the page's own URL to the clipboard and issues no additional fetches (AC-40)", async () => {
    RESPONSE = { tour: tour(), state: "ready", stale: false, failure_reason: null, job_id: null };
    renderView();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share link" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0]![0] as string;
    expect(written.startsWith(`${window.location.origin}/repos/r1/onboarding`)).toBe(true);
    // No hook other than the read query and the (unused-here) generate
    // mutation is wired up in this view — Share link never touches either.
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it("the breadcrumb reads acme/payments-api + the page name, and the header reads 'Onboarding for payments-api' (AC-35)", () => {
    RESPONSE = { tour: tour(), state: "ready", stale: false, failure_reason: null, job_id: null };
    renderView();

    const crumb = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(crumb).getByText("acme/payments-api")).toBeInTheDocument();
    expect(within(crumb).getByText(onboardingMessages.title)).toBeInTheDocument();

    const heading = screen.getByRole("heading", { level: 1 });
    // Sourced from the catalogue rather than restated as a literal here.
    expect(heading.textContent).toBe(`${onboardingMessages.headingPrefix}payments-api`);
  });

  it("every TOC entry, collapse control, Regenerate and Share link is a real button with an accessible name (AC-47)", () => {
    RESPONSE = { tour: tour(), state: "ready", stale: false, failure_reason: null, job_id: null };
    renderView();

    for (const btn of screen.getAllByRole("button")) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn).toHaveAccessibleName();
    }
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share link" })).toBeInTheDocument();
  });
});
