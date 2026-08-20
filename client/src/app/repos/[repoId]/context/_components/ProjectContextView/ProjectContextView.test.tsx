import type { ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  ProjectContextDocument,
  ProjectContextDrift,
  ProjectContextDriftOwner,
  ProjectContextListResponse,
  ProjectContextPreview,
} from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

function doc(over: Partial<ProjectContextDocument> = {}): ProjectContextDocument {
  return {
    path: "specs/public-api.md",
    type: "specs",
    size_bytes: 1200,
    content_hash: "hash-1",
    tokens: 300,
    used_by_agents: 2,
    drifted_for: [],
    ...over,
  };
}

const AGENT_OWNER: ProjectContextDriftOwner = { owner_kind: "agent", owner_id: "ag1", owner_name: "Security Reviewer" };
const SKILL_OWNER: ProjectContextDriftOwner = { owner_kind: "skill", owner_id: "sk1", owner_name: "PR Quality Rubric" };

function listResponse(over: Partial<ProjectContextListResponse> = {}): ProjectContextListResponse {
  return {
    documents: [doc()],
    scanned_at: "2026-08-18T09:00:00Z",
    roots: ["specs/", "docs/", "insights/"],
    conventional_filenames: ["insights.md"],
    budget_tokens: 12000,
    clone_head: "abc1234def",
    ...over,
  };
}

let DATA: ProjectContextListResponse | undefined = listResponse();
let LIST_LOADING = false;
let LIST_ERROR = false;
const REFETCH = vi.fn();
const RESCAN_MUTATE = vi.fn();
let RESCAN_PENDING = false;
let PREVIEW: ProjectContextPreview | undefined;
let PREVIEW_LOADING = false;
// ---- Drift detail (AC-37, AC-38) — mocked at the hook boundary so the
// drift-detail wiring is exercised without a real QueryClient/api layer,
// same rationale as the rest of this file's hook mocks. ----
let DRIFT: ProjectContextDrift | undefined;
let DRIFT_LOADING = false;
const CONFIRM_DRIFT_MUTATE = vi.fn((_args: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
let CONFIRM_DRIFT_PENDING = false;

vi.mock("@/lib/hooks", () => ({
  useProjectContextDocuments: () => ({
    data: DATA,
    isLoading: LIST_LOADING,
    isError: LIST_ERROR,
    error: null,
    refetch: REFETCH,
  }),
  useRescanProjectContext: () => ({
    mutate: RESCAN_MUTATE,
    isPending: RESCAN_PENDING,
  }),
  useDocumentPreview: (_repoId: unknown, path: string | null | undefined) => ({
    data: path ? PREVIEW : undefined,
    isLoading: PREVIEW_LOADING,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDocumentDrift: (
    _repoId: unknown,
    ownerKind: unknown,
    ownerId: unknown,
    path: unknown,
  ) => ({
    data: ownerKind && ownerId && path ? DRIFT : undefined,
    isLoading: DRIFT_LOADING,
  }),
  useConfirmDrift: () => ({
    mutate: CONFIRM_DRIFT_MUTATE,
    isPending: CONFIRM_DRIFT_PENDING,
  }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", name: "payments-api", full_name: "acme/payments-api" },
  }),
  useRepoNotFound: () => false,
}));

// The full AppShell drags in the command palette / shortcuts machinery, which
// has nothing to do with this view's own logic (same rationale as
// ConventionsView.test.tsx).
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  DATA = listResponse();
  LIST_LOADING = false;
  LIST_ERROR = false;
  RESCAN_PENDING = false;
  PREVIEW = undefined;
  PREVIEW_LOADING = false;
  DRIFT = undefined;
  DRIFT_LOADING = false;
  CONFIRM_DRIFT_PENDING = false;
  vi.clearAllMocks();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("names exactly the configured roots and filenames in the no-documents empty state (AC-43)", () => {
    DATA = listResponse({
      documents: [],
      roots: ["specs/", "docs/", "insights/"],
      conventional_filenames: ["insights.md"],
    });
    renderView();

    const body = screen.getByText(/DevDigest reads Markdown from/);
    // Every configured root and filename appears, joined from the API's own
    // arrays — never a hardcoded "specs/, docs/ and insights/" literal.
    expect(body.textContent).toContain("specs/, docs/ and insights/");
    expect(body.textContent).toContain("insights.md");
    // And nothing that wasn't configured leaks in.
    expect(body.textContent).not.toContain("guides/");
  });

  it("renders the not_cloned empty state, distinct from the no-documents one (AC-4)", () => {
    DATA = listResponse({ documents: [], reason: "not_cloned" });
    renderView();

    expect(screen.getByText(messages.page.empty.notCloned.title)).toBeDefined();
    expect(screen.queryByText(messages.page.empty.noDocuments.title)).toBeNull();
  });

  it("issues the rescan mutation and reflects a grown list (AC-6)", () => {
    DATA = listResponse({ documents: [doc({ path: "specs/a.md" })] });
    const { rerender } = renderView();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: messages.page.rescan }));
    expect(RESCAN_MUTATE).toHaveBeenCalledTimes(1);

    // Simulate the mutation's onSuccess growing the cached list by one.
    DATA = listResponse({
      documents: [doc({ path: "specs/a.md" }), doc({ path: "specs/b.md" })],
    });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ProjectContextView repoId="r1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the short sha of the revision the listed documents came from", () => {
    DATA = listResponse({ clone_head: "b5365ee1234567890abcdef" });
    renderView();

    // Short form only — a full 40-char sha in a subtitle is noise.
    expect(screen.getByText(/at b5365ee/)).toBeDefined();
    expect(screen.queryByText(/b5365ee1234567890abcdef/)).toBeNull();
  });

  it("surfaces a failed origin fetch as a notice while still rendering the stale list", () => {
    DATA = listResponse({
      documents: [doc({ path: "specs/a.md" })],
      sync_error: "fatal: could not read Username",
      clone_head: "old1111",
    });
    renderView();

    // The reason is shown, not swallowed: a silent stale list is exactly the
    // failure this whole flow exists to make visible.
    const notice = screen.getByText(/Couldn't fetch the latest from origin/);
    expect(notice.textContent).toContain("fatal: could not read Username");
    // Degraded, not broken — the documents the clone still holds are listed.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows no fetch-failure notice on a clean load", () => {
    DATA = listResponse();
    renderView();
    expect(screen.queryByText(/Couldn't fetch the latest from origin/)).toBeNull();
  });

  it("disables Rescan and shows the in-progress label while a rescan is pending", () => {
    RESCAN_PENDING = true;
    renderView();
    const btn = screen.getByRole("button", { name: messages.page.rescanning });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("marks a drifted document with a non-colour-only badge (AC-36)", () => {
    DATA = listResponse({
      documents: [
        doc({ path: "specs/a.md", drifted_for: [AGENT_OWNER] }),
        doc({ path: "specs/b.md", drifted_for: [] }),
      ],
    });
    renderView();
    // DriftBadge always pairs an icon with this text — never colour alone.
    expect(screen.getAllByText(messages.drift.badge)).toHaveLength(1);
  });

  it("lists a drifted document's owners by name, not raw ids (AC-36)", () => {
    DATA = listResponse({
      documents: [doc({ path: "specs/a.md", drifted_for: [AGENT_OWNER, SKILL_OWNER] })],
    });
    renderView();

    expect(screen.getByRole("button", { name: AGENT_OWNER.owner_name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SKILL_OWNER.owner_name })).toBeInTheDocument();
    expect(screen.queryByText(AGENT_OWNER.owner_id)).not.toBeInTheDocument();
  });

  it("clicking an owner opens the drift detail showing both versions (AC-38)", () => {
    DATA = listResponse({
      documents: [doc({ path: "specs/a.md", drifted_for: [AGENT_OWNER] })],
    });
    DRIFT = {
      path: "specs/a.md",
      attached_revision: "rev1",
      previous: "old body text",
      current: "new body text",
      previous_unavailable: false,
    };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: AGENT_OWNER.owner_name }));

    expect(screen.getByText("old body text")).toBeInTheDocument();
    expect(screen.getByText("new body text")).toBeInTheDocument();
  });

  it("a previous_unavailable drift response renders the note and still allows confirm (AC-38)", () => {
    DATA = listResponse({
      documents: [doc({ path: "specs/a.md", drifted_for: [AGENT_OWNER] })],
    });
    DRIFT = {
      path: "specs/a.md",
      attached_revision: "rev1",
      current: "new body text",
      previous_unavailable: true,
    };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: AGENT_OWNER.owner_name }));

    expect(screen.getByText(messages.drift.detail.previousUnavailable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.drift.detail.confirm })).toBeInTheDocument();
  });

  it("confirming a drift issues the mutation and clears the marker (AC-37)", () => {
    DATA = listResponse({
      documents: [doc({ path: "specs/a.md", drifted_for: [AGENT_OWNER] })],
    });
    DRIFT = {
      path: "specs/a.md",
      attached_revision: "rev1",
      previous: "old body text",
      current: "new body text",
      previous_unavailable: false,
    };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: AGENT_OWNER.owner_name }));
    fireEvent.click(screen.getByRole("button", { name: messages.drift.detail.confirm }));

    expect(CONFIRM_DRIFT_MUTATE).toHaveBeenCalledTimes(1);
    expect(CONFIRM_DRIFT_MUTATE.mock.calls[0]?.[0]).toMatchObject({
      repoId: "r1",
      ownerKind: "agent",
      ownerId: AGENT_OWNER.owner_id,
      path: "specs/a.md",
    });
    // The mocked mutation's onSuccess runs synchronously, closing the panel.
    expect(screen.queryByText(messages.drift.detail.title)).not.toBeInTheDocument();
  });

  it("previews a selected document's content, tokens, and used-by count (AC-10, AC-11)", () => {
    DATA = listResponse({ documents: [doc({ path: "specs/public-api.md" })] });
    PREVIEW = {
      path: "specs/public-api.md",
      type: "specs",
      size_bytes: 1200,
      content_hash: "hash-1",
      tokens: 300,
      used_by_agents: 2,
      drifted_for: [],
      body: "# Public API\n\nDetails.",
      truncated: false,
    };
    renderView();

    fireEvent.click(screen.getByText("public-api.md"));
    expect(screen.getByRole("heading", { name: "Public API" })).toBeDefined();
    expect(screen.getAllByText("≈ 300 tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Used by 2 agents").length).toBeGreaterThan(0);
  });

  it("shows omission counters when the discovery caps fired (AC-5)", () => {
    DATA = listResponse({ omitted: { by_count: 4, by_size: 1 } });
    renderView();
    expect(screen.getByText(/4 document\(s\) omitted — over the discovery limit\./)).toBeDefined();
    expect(screen.getByText(/1 document\(s\) omitted — over the per-file size limit\./)).toBeDefined();
  });
});
