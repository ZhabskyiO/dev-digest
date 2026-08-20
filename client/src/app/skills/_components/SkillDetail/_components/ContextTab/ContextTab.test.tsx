import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Skill,
  Repo,
  ProjectContextListResponse,
  ProjectContextDocument,
  ProjectContextAttachment,
} from "@devdigest/shared";
import skillsMessages from "../../../../../../../messages/en/skills.json";
import contextMessages from "../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../lib/toast";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\n\nEvaluate the pull request.",
  enabled: true,
  version: 5,
};

const REPO: Repo = {
  id: "repo1",
  workspace_id: "w1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: "/clones/repo1",
  last_polled_at: null,
  created_by: null,
};

const DOCS: ProjectContextDocument[] = [
  { path: "specs/security-baseline.md", type: "specs", size_bytes: 1200, content_hash: "h1", tokens: 139, used_by_agents: 2, drifted_for: [] },
  { path: "specs/public-api.md", type: "specs", size_bytes: 900, content_hash: "h2", tokens: 178, used_by_agents: 3, drifted_for: [] },
];

const DOCS_RESPONSE = (): ProjectContextListResponse => ({
  documents: DOCS,
  scanned_at: "2026-08-18T00:00:00.000Z",
  roots: ["specs", "docs", "insights"],
  conventional_filenames: [],
  budget_tokens: 1000,
  clone_head: "abc1234def",
});

// ---- Tiny in-memory "server" the mocked api module reads/writes so the real
// hooks (useRepos/useProjectContextDocuments/useSkillContext/useUpdateSkill)
// exercise real React Query reactivity end to end, matching AgentEditor's
// ContextTab.test.tsx pattern. ----
let skillAttachments: ProjectContextAttachment[] = [];
let skillBody = SKILL.body;
let putCalls: { path: string; body: Record<string, unknown> }[] = [];
// ---- Drift confirm/detail (AC-37, AC-38) — same small "server" slice as
// AgentEditor's ContextTab.test.tsx. ----
let driftedPaths = new Set<string>();
let previousUnavailable = false;
let confirmCalls: { owner_kind: string; owner_id: string; path: string }[] = [];

vi.mock("../../../../../../lib/api", () => ({
  api: {
    get: vi.fn((path: string) => {
      if (path === "/repos") return Promise.resolve([REPO]);
      if (path === `/repos/${REPO.id}/context/documents`) return Promise.resolve(DOCS_RESPONSE());
      if (path === `/skills/${SKILL.id}/context`) {
        return Promise.resolve(
          skillAttachments.map((a) => ({ ...a, drift: driftedPaths.has(a.path) || undefined })),
        );
      }
      if (path.startsWith(`/repos/${REPO.id}/context/documents/preview?`)) {
        const qs = new URLSearchParams(path.split("?")[1]);
        const docPath = qs.get("path") ?? "";
        return Promise.resolve({
          path: docPath,
          body: `# ${docPath}\n\nrendered preview body`,
          tokens: 42,
          truncated: false,
          used_by_agents: 1,
        });
      }
      if (path.startsWith(`/repos/${REPO.id}/context/drift?`)) {
        const qs = new URLSearchParams(path.split("?")[1]);
        const docPath = qs.get("path") ?? "";
        return Promise.resolve(
          previousUnavailable
            ? { path: docPath, attached_revision: "rev1", current: "new body text", previous_unavailable: true }
            : {
                path: docPath,
                attached_revision: "rev1",
                previous: "old body text",
                current: "new body text",
                previous_unavailable: false,
              },
        );
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    }),
    put: vi.fn((path: string, body: Record<string, unknown>) => {
      putCalls.push({ path, body });
      if (path !== `/skills/${SKILL.id}`) return Promise.reject(new Error(`unexpected PUT ${path}`));
      if (typeof body.body === "string") skillBody = body.body;
      if (Array.isArray(body.context)) {
        skillAttachments = (body.context as { repo_id: string; path: string }[]).map((ref, i) => ({
          repo_id: ref.repo_id,
          path: ref.path,
          order: i,
          attached_hash: "h",
          attached_size: 0,
          attached_revision: "rev1",
        }));
      }
      return Promise.resolve({ ...SKILL, body: skillBody });
    }),
    post: vi.fn((path: string, body?: { owner_kind: string; owner_id: string; path: string }) => {
      if (path === `/repos/${REPO.id}/context/confirm` && body) {
        driftedPaths.delete(body.path);
        confirmCalls.push(body);
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected POST ${path}`));
    }),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

// The tab reads the active repo from the shell's repo context (there is no
// tab-local picker any more), so the real provider is mounted rather than
// stubbed — it resolves the repo from `/repos`, which this suite already mocks.
vi.mock("next/navigation", () => ({
  usePathname: () => "/skills",
}));

import { RepoProvider } from "../../../../../../lib/repo-context";
import { ContextTab } from "./ContextTab";

beforeEach(() => {
  skillAttachments = [];
  skillBody = SKILL.body;
  putCalls = [];
  driftedPaths = new Set();
  previousUnavailable = false;
  confirmCalls = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab(skill: Skill = SKILL) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RepoProvider>
        <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages, context: contextMessages }}>
          <ToastProvider>
            <ContextTab skill={skill} />
          </ToastProvider>
        </NextIntlClientProvider>
      </RepoProvider>
    </QueryClientProvider>,
  );
}

describe("ContextTab", () => {
  it("a checked document survives a remount from the mocked API response (AC-13)", async () => {
    renderTab();

    const checkbox = await screen.findByRole("checkbox", { name: /public-api\.md/ });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    fireEvent.click(checkbox);
    // Attaching MOVES the row out of the browse list and into the ordered
    // "Attached documents" list above, so the node just clicked is gone —
    // re-query rather than asserting on the stale reference.
    expect(await screen.findByRole("checkbox", { name: /public-api\.md/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const saveButton = screen.getByRole("button", { name: contextMessages.skillSection.save });
    fireEvent.click(saveButton);

    // Wait for the PATCH to land in the mocked "server" — the attachment is
    // now persisted, not just held in local draft state.
    await screen.findByText(contextMessages.skillSection.savedToast);
    expect(skillAttachments).toEqual([
      { repo_id: REPO.id, path: "specs/public-api.md", order: 0, attached_hash: "h", attached_size: 0, attached_revision: "rev1" },
    ]);

    // Simulate a full reload: unmount and render fresh against a brand-new
    // QueryClient, so nothing survives except what the mocked API now
    // returns for GET /skills/:id/context.
    cleanup();
    renderTab();

    const reloaded = await screen.findByRole("checkbox", { name: /public-api\.md/ });
    expect(reloaded).toHaveAttribute("aria-checked", "true");
  });

  it("editing the body and toggling a document issues exactly one PATCH carrying both fields (AC-42)", async () => {
    // "Editing the body" is represented by the `skill` prop already carrying
    // the edited value (e.g. a save already committed by ConfigTab) — the
    // point under test is that ContextTab's OWN save call bundles it
    // alongside `context` in one PATCH rather than a second, context-only
    // mutation (Known gotcha: a separate mutation would append a second
    // skill_versions row for one logical save).
    const editedSkill: Skill = { ...SKILL, body: "# PR Quality Rubric\n\nEdited body." };
    renderTab(editedSkill);

    const checkbox = await screen.findByRole("checkbox", { name: /security-baseline\.md/ });
    fireEvent.click(checkbox);

    const saveButton = await screen.findByRole("button", { name: contextMessages.skillSection.save });
    fireEvent.click(saveButton);

    await screen.findByText(contextMessages.skillSection.savedToast);

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.path).toBe(`/skills/${SKILL.id}`);
    expect(putCalls[0]?.body).toMatchObject({
      body: editedSkill.body,
      context: [{ repo_id: REPO.id, path: "specs/security-baseline.md" }],
    });
  });

  it("a drifted attached document's marker is clickable, opens the detail showing both versions, and confirming clears it (AC-37, AC-38)", async () => {
    skillAttachments = [
      { repo_id: REPO.id, path: "specs/public-api.md", order: 0, attached_hash: "h", attached_size: 0, attached_revision: "rev1" },
    ];
    driftedPaths = new Set(["specs/public-api.md"]);
    renderTab();

    const marker = await screen.findByRole("button", { name: contextMessages.drift.viewChange });
    fireEvent.click(marker);

    expect(await screen.findByText("old body text")).toBeInTheDocument();
    expect(await screen.findByText("new body text")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: contextMessages.drift.detail.confirm }));

    await waitFor(() => expect(confirmCalls).toHaveLength(1));
    expect(confirmCalls[0]).toMatchObject({ owner_kind: "skill", owner_id: SKILL.id, path: "specs/public-api.md" });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: contextMessages.drift.viewChange })).not.toBeInTheDocument(),
    );
  });

  it("a previous_unavailable drift response renders the note and still allows confirm (AC-38)", async () => {
    skillAttachments = [
      { repo_id: REPO.id, path: "specs/public-api.md", order: 0, attached_hash: "h", attached_size: 0, attached_revision: "rev1" },
    ];
    driftedPaths = new Set(["specs/public-api.md"]);
    previousUnavailable = true;
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: contextMessages.drift.viewChange }));

    await screen.findByText(contextMessages.drift.detail.previousUnavailable);
    expect(screen.getByRole("button", { name: contextMessages.drift.detail.confirm })).toBeInTheDocument();
  });
  it("has no repository picker of its own — the repo comes from the shell", async () => {
    renderTab();
    await screen.findByRole("checkbox", { name: /specs\/public-api\.md/ });

    expect(screen.queryByRole("combobox")).toBeNull();
    // The hint names the active repo instead of a selector label.
    expect(screen.getByText(new RegExp(`Attaching from ${REPO.full_name}`))).toBeInTheDocument();
  });

  it("previews a document in a right-side drawer, closable again", async () => {
    renderTab();

    const previews = await screen.findAllByRole("button", { name: contextMessages.attachments.preview });
    fireEvent.click(previews[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await within(dialog).findByText(/rendered preview body/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers a drag handle on attached rows and no move arrows", async () => {
    skillAttachments = [
      { repo_id: REPO.id, path: "specs/public-api.md", order: 0, attached_hash: "h", attached_size: 0, attached_revision: "rev1" },
    ];
    renderTab();
    await screen.findByRole("button", { name: /Reorder public-api\.md/ });
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });

  it("renders the ATTACHED list in attachment order, not catalog order — and never puts an unattached row in it", async () => {
    // Catalog order is security-baseline, public-api (see DOCS); the
    // attachment order is the reverse. The sortable list must follow the
    // ATTACHMENT order: rendering the catalog here is what made a drag snap
    // back to its old position while enabling Save.
    skillAttachments = [
      { repo_id: REPO.id, path: "specs/public-api.md", order: 0, attached_hash: "h", attached_size: 0, attached_revision: "rev1" },
      { repo_id: REPO.id, path: "specs/security-baseline.md", order: 1, attached_hash: "h", attached_size: 0, attached_revision: "rev1" },
    ];
    renderTab();

    await screen.findByRole("button", { name: /Reorder public-api\.md/ });
    // Only rows with a drag handle are in the sortable list.
    const handles = screen.getAllByRole("button", { name: /^Reorder / });
    expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
      "Reorder public-api.md — press Space to pick up, arrow keys to move",
      "Reorder security-baseline.md — press Space to pick up, arrow keys to move",
    ]);

    // …and an unattached catalog document is NOT one of them.
    expect(
      screen.queryByRole("button", { name: /Reorder setup\.md/ }),
    ).toBeNull();
  });
});
