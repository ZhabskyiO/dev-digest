import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidateDetail } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { githubBlobUrl } from "./helpers";

function candidate(over: Partial<ConventionCandidateDetail> = {}): ConventionCandidateDetail {
  return {
    id: "c1",
    rule: "Validate request payloads with a zod schema.",
    category: "typing",
    evidence_path: "src/user.ts",
    evidence_line: 3,
    evidence_snippet: "export const UserSchema = z.object({",
    confidence: 0.9,
    status: "pending",
    accepted: false,
    skill_id: null,
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

let CANDIDATES: ConventionCandidateDetail[] = [];
const extractMutate = vi.fn();
const updateMutate = vi.fn();
let extracting = false;
let extractData: unknown;

vi.mock("@/lib/hooks", () => ({
  useConventions: () => ({
    data: CANDIDATES,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({
    mutate: extractMutate,
    isPending: extracting,
    isError: false,
    data: extractData,
  }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: {
      id: "r1",
      name: "payments-api",
      full_name: "acme/payments-api",
      default_branch: "main",
    },
  }),
  useRepoNotFound: () => false,
}));

// The full AppShell drags in the command palette / shortcuts machinery, which
// has nothing to do with this view's own logic.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The modal owns its own data hooks; this suite covers the list, not the modal.
vi.mock("./_components/CreateSkillModal", () => ({
  CreateSkillModal: ({ candidates }: { candidates: ConventionCandidateDetail[] }) => (
    <div data-testid="create-skill-modal">{candidates.length}</div>
  ),
}));

import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  CANDIDATES = [];
  extracting = false;
  extractData = undefined;
  vi.clearAllMocks();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionsView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("githubBlobUrl", () => {
  const repo = { full_name: "acme/payments-api", default_branch: "main" };

  it("builds a blob permalink anchored on the cited line", () => {
    expect(githubBlobUrl(repo, candidate())).toBe(
      "https://github.com/acme/payments-api/blob/main/src/user.ts#L3",
    );
  });

  it("drops the anchor when the line is unknown", () => {
    expect(githubBlobUrl(repo, candidate({ evidence_line: null }))).toBe(
      "https://github.com/acme/payments-api/blob/main/src/user.ts",
    );
  });

  it("encodes path segments but keeps the separators", () => {
    const url = githubBlobUrl(repo, candidate({ evidence_path: "src/my dir/a#b.ts" }));
    expect(url).toBe("https://github.com/acme/payments-api/blob/main/src/my%20dir/a%23b.ts#L3");
  });

  it("returns null before the repo has loaded", () => {
    expect(githubBlobUrl(null, candidate())).toBeNull();
    expect(githubBlobUrl(undefined, candidate())).toBeNull();
  });

  it("returns null when the candidate has no path", () => {
    expect(githubBlobUrl(repo, candidate({ evidence_path: "" }))).toBeNull();
  });
});

describe("ConventionsView", () => {
  it("offers extraction from the empty state when nothing has been scanned", () => {
    renderView();
    expect(screen.getByText(messages.page.empty.title)).toBeDefined();
    // Both the header action and the empty-state CTA read "Run extraction";
    // the CTA is the last one in the tree.
    const ctas = screen.getAllByRole("button", { name: messages.page.empty.cta });
    fireEvent.click(ctas[ctas.length - 1]!);
    expect(extractMutate).toHaveBeenCalled();
  });

  it("shows the rule and its file:line citation", () => {
    CANDIDATES = [candidate()];
    renderView();
    expect(screen.getByText("Validate request payloads with a zod schema.")).toBeDefined();
    expect(screen.getByText("src/user.ts:3")).toBeDefined();
    expect(screen.getByText("export const UserSchema = z.object({")).toBeDefined();
  });

  it("links the evidence to GitHub, safely opened in a new tab", () => {
    CANDIDATES = [candidate()];
    renderView();
    const link = screen.getByRole("link", { name: messages.card.github });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/payments-api/blob/main/src/user.ts#L3",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    // rel=noopener is what stops the opened tab reaching back via window.opener.
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("counts how many candidates are accepted", () => {
    CANDIDATES = [
      candidate({ id: "c1" }),
      candidate({ id: "c2", rule: "Second", status: "accepted", accepted: true }),
    ];
    renderView();
    expect(screen.getByText("1 of 2 accepted")).toBeDefined();
  });

  it("defaults to the pending filter and hides reviewed candidates", () => {
    CANDIDATES = [
      candidate({ id: "c1", rule: "Pending rule" }),
      candidate({ id: "c2", rule: "Rejected rule", status: "rejected" }),
    ];
    renderView();
    expect(screen.getByText("Pending rule")).toBeDefined();
    expect(screen.queryByText("Rejected rule")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: messages.filter.rejected }));
    expect(screen.getByText("Rejected rule")).toBeDefined();
    expect(screen.queryByText("Pending rule")).toBeNull();
  });

  it("accepts a candidate through the update hook", () => {
    CANDIDATES = [candidate()];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.card.accept }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });
  });

  it("rejects a candidate through the update hook", () => {
    CANDIDATES = [candidate()];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.card.reject }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "rejected" } });
  });

  it("saves an edited rule with its category", () => {
    CANDIDATES = [candidate()];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.card.edit }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Validate payloads at the route edge." },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.card.save }));
    expect(updateMutate).toHaveBeenCalledWith({
      id: "c1",
      patch: { rule: "Validate payloads at the route edge.", category: "typing" },
    });
  });

  it("hides Create skill until at least one candidate is accepted", () => {
    CANDIDATES = [candidate()];
    renderView();
    expect(screen.queryByRole("button", { name: messages.page.createSkill })).toBeNull();
  });

  it("shows Create skill next to Re-scan once something is accepted", () => {
    CANDIDATES = [candidate({ status: "accepted", accepted: true })];
    renderView();
    expect(screen.getByRole("button", { name: messages.page.rescan })).toBeDefined();
    expect(screen.getByRole("button", { name: messages.page.createSkill })).toBeDefined();
  });

  it("opens the modal with only the accepted candidates", () => {
    CANDIDATES = [
      candidate({ id: "c1", rule: "Accepted one", status: "accepted", accepted: true }),
      candidate({ id: "c2", rule: "Still pending" }),
      candidate({ id: "c3", rule: "Rejected one", status: "rejected" }),
    ];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: messages.page.createSkill }));
    expect(within(screen.getByTestId("create-skill-modal")).getByText("1")).toBeDefined();
  });

  it("explains the not-indexed case instead of showing an empty scan", () => {
    extractData = {
      candidates: [],
      sampled_files: [],
      dropped: 0,
      duplicates: 0,
      cost_usd: null,
      degraded: true,
      reason: "not_indexed",
    };
    renderView();
    expect(screen.getByText(messages.page.notIndexedTitle)).toBeDefined();
  });

  it("reports what the scan kept, dropped and already knew", () => {
    CANDIDATES = [candidate()];
    extractData = {
      candidates: [candidate()],
      sampled_files: ["src/user.ts"],
      dropped: 2,
      duplicates: 1,
      cost_usd: 0.01,
    };
    renderView();
    expect(screen.getByText(/2 dropped for unverifiable evidence/)).toBeDefined();
    expect(screen.getByText(/1 already known/)).toBeDefined();
  });

  it("disables the scan button while extraction is running", () => {
    extracting = true;
    renderView();
    const btn = screen.getByRole("button", { name: messages.page.scanning });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});
