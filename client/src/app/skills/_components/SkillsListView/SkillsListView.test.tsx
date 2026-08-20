import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const SKILLS: Skill[] = [
  {
    id: "sk1",
    name: "uncovered-branch-gate",
    description: "Flags branches with no covering test.",
    type: "rubric",
    source: "manual",
    body: "# Uncovered branch gate",
    enabled: true,
    version: 1,
  },
  {
    id: "sk2",
    name: "mock-overuse",
    description: "Catches over-mocking.",
    type: "convention",
    source: "manual",
    body: "# Mock overuse",
    enabled: true,
    version: 1,
  },
];

const SUMMARIES = [
  { skill_id: "sk1", agents_using: 3, pull_pct: 71, accept_rate: 74 },
  { skill_id: "sk2", agents_using: 1, pull_pct: null, accept_rate: null },
];

const updateMutate = vi.fn();

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useSkillStatsSummary: () => ({ data: SUMMARIES }),
}));

// The detail pane owns its own data hooks (versions, stats, agents) and pulls in
// CodeMirror; this suite covers the rail and the URL wiring, not the tabs.
// The allowlist is imported for real (via `vi.hoisted`) rather than restated:
// the literal that used to sit here had already gone stale — it was missing
// `context` — so this suite would have passed against a broken tab bar.
const detailConstants = await vi.hoisted(
  async () => await import("../SkillDetail/constants"),
);

vi.mock("../SkillDetail", () => ({
  SkillDetail: ({ skill, tab }: { skill: { name: string }; tab: string }) => (
    <div data-testid="skill-detail">{`${skill.name}:${tab}`}</div>
  ),
  TAB_KEYS: detailConstants.TAB_KEYS,
  DEFAULT_TAB: detailConstants.DEFAULT_TAB,
}));

const push = vi.fn();
const replace = vi.fn();
let searchParamsValue = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

// The full AppShell pulls in the command palette / shortcuts-help / repo
// context machinery — irrelevant to this component's own logic, so it is
// swapped for a thin passthrough (mirrors how AgentEditor.test.tsx mocks out
// its data-hook dependencies to isolate the unit under test).
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SkillsListView } from "./SkillsListView";

afterEach(() => {
  cleanup();
  searchParamsValue = "";
  vi.clearAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsListView />
    </NextIntlClientProvider>,
  );
}

describe("SkillsListView (smoke)", () => {
  it("renders every skill from the catalog", () => {
    renderWithIntl();
    expect(screen.getByText("uncovered-branch-gate")).toBeInTheDocument();
    expect(screen.getByText("mock-overuse")).toBeInTheDocument();
  });

  it("filters the list via the search box", () => {
    renderWithIntl();
    fireEvent.change(screen.getByPlaceholderText("Search skills…"), { target: { value: "mock" } });
    expect(screen.queryByText("uncovered-branch-gate")).not.toBeInTheDocument();
    expect(screen.getByText("mock-overuse")).toBeInTheDocument();
  });

  it("shows the select-prompt copy when nothing is selected via ?id=", () => {
    renderWithIntl();
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
  });

  it("shows the detail pane when ?id= matches a catalog entry", () => {
    searchParamsValue = "id=sk2";
    renderWithIntl();
    expect(screen.queryByText("Select a skill")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-detail")).toHaveTextContent("mock-overuse:config");
  });

  it("defaults to the config tab and honours a valid ?tab=", () => {
    searchParamsValue = "id=sk2&tab=versions";
    renderWithIntl();
    expect(screen.getByTestId("skill-detail")).toHaveTextContent("mock-overuse:versions");
  });

  it("falls back to config for a ?tab= that isn't a real tab", () => {
    searchParamsValue = "id=sk2&tab=nonsense";
    renderWithIntl();
    expect(screen.getByTestId("skill-detail")).toHaveTextContent("mock-overuse:config");
  });

  it("carries the current tab across to the clicked skill", () => {
    searchParamsValue = "id=sk1&tab=stats";
    renderWithIntl();
    fireEvent.click(screen.getByText("mock-overuse"));
    expect(push).toHaveBeenCalledWith("/skills?id=sk2&tab=stats");
  });

  it("shows per-skill stats on the rail card, omitting the unknown ratios", () => {
    renderWithIntl();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("71% pull")).toBeInTheDocument();
    expect(screen.getByText("74% accept")).toBeInTheDocument();
    // sk2 has null ratios — they must not render as 0%.
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(screen.queryByText("0% pull")).not.toBeInTheDocument();
  });
});
