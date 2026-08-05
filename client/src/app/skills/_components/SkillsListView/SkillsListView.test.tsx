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

const updateMutate = vi.fn();

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
}));

const push = vi.fn();
let searchParamsValue = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
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

  it("shows the selected skill's preview pane when ?id= matches a catalog entry", () => {
    searchParamsValue = "id=sk2";
    renderWithIntl();
    expect(screen.queryByText("Select a skill")).not.toBeInTheDocument();
    // SkillPreview renders the body via <Markdown> — its own heading text confirms selection worked.
    expect(screen.getByText("Mock overuse")).toBeInTheDocument();
  });

  it("navigates to the clicked skill's id on card click", () => {
    renderWithIntl();
    fireEvent.click(screen.getByText("mock-overuse"));
    expect(push).toHaveBeenCalledWith("/skills?id=sk2");
  });
});
