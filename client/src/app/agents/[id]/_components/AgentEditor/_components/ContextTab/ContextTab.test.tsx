import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  Repo,
  Skill,
  ProjectContextListResponse,
  ProjectContextDocument,
  EffectiveProjectContext,
  EffectiveProjectContextDoc,
} from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";

// Builds the expected rendered copy from the imported messages fixture
// instead of restating the English text as a literal — a literal passes
// even after the underlying message key's meaning changes (client/insights/
// gotchas.md, 2026-08-20).
function fill(template: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)), template);
}

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review the diff.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const REPO: Repo = {
  id: "repo1",
  workspace_id: "w1",
  owner: "acme",
  name: "widgets",
  full_name: "acme/widgets",
  default_branch: "main",
  clone_path: "/clones/repo1",
  last_polled_at: null,
  created_by: null,
};

const REPO2: Repo = {
  id: "repo2",
  workspace_id: "w1",
  owner: "acme",
  name: "gadgets",
  full_name: "acme/gadgets",
  default_branch: "main",
  clone_path: "/clones/repo2",
  last_polled_at: null,
  created_by: null,
};

const SKILL_SECURITY: Skill = {
  id: "sk1",
  name: "Security Rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
};

const DOCS: ProjectContextDocument[] = [
  { path: "specs/security-baseline.md", type: "specs", size_bytes: 1200, content_hash: "h1", tokens: 120, used_by_agents: 0, drifted_for: [] },
  { path: "specs/public-api.md", type: "specs", size_bytes: 900, content_hash: "h2", tokens: 90, used_by_agents: 0, drifted_for: [] },
  { path: "docs/setup.md", type: "docs", size_bytes: 500, content_hash: "h3", tokens: 50, used_by_agents: 0, drifted_for: [] },
];

const DOCS_RESPONSE = (): ProjectContextListResponse => ({
  documents: DOCS,
  scanned_at: "2026-08-18T00:00:00.000Z",
  roots: ["specs", "docs", "insights"],
  conventional_filenames: [],
  budget_tokens: budgetTokens,
  clone_head: "abc1234def",
});

// ---- Tiny in-memory "server" the mocked api module reads/writes so the
// real hooks (useRepos/useProjectContextDocuments/useAgentContext/
// useSetAgentContext) exercise real React Query reactivity end to end. ----
let agentDirectRefs: { repo_id: string; path: string }[] = [];
let inherited: EffectiveProjectContextDoc[] = [];
let budgetTokens = 1000;
// ---- Drift confirm/detail (AC-37, AC-38) — a small extra slice of the same
// in-memory "server": which paths currently show drift, whether the
// attach-time revision is still resolvable, and what confirm() recorded. ----
let driftedPaths = new Set<string>();
let previousUnavailable = false;
let confirmCalls: { owner_kind: string; owner_id: string; path: string }[] = [];

function tokensFor(path: string): number {
  return DOCS.find((d) => d.path === path)?.tokens ?? 0;
}
function typeFor(path: string): ProjectContextDocument["type"] {
  return DOCS.find((d) => d.path === path)?.type ?? "docs";
}

function computeEffective(): EffectiveProjectContext {
  const directDocs: EffectiveProjectContextDoc[] = agentDirectRefs.map((r) => ({
    repo_id: r.repo_id,
    path: r.path,
    type: typeFor(r.path),
    tokens: tokensFor(r.path),
    source: "agent",
    drift: driftedPaths.has(r.path) || undefined,
  }));
  const directPaths = new Set(directDocs.map((d) => d.path));
  const inheritedFiltered = inherited
    .filter((d) => !directPaths.has(d.path))
    .map((d) => ({ ...d, drift: driftedPaths.has(d.path) || undefined }));
  const documents = [...directDocs, ...inheritedFiltered];

  let tally = 0;
  const dropped: string[] = [];
  for (const d of documents) {
    if (tally + d.tokens > budgetTokens) {
      dropped.push(d.path);
    } else {
      tally += d.tokens;
    }
  }
  return {
    documents,
    total_tokens: documents.reduce((sum, d) => sum + d.tokens, 0),
    budget_tokens: budgetTokens,
    over_budget: dropped.length > 0,
    dropped_paths: dropped,
  };
}

vi.mock("../../../../../../../lib/api", () => ({
  api: {
    get: vi.fn((path: string) => {
      if (path === "/repos") return Promise.resolve([REPO]);
      if (path === "/skills") return Promise.resolve([SKILL_SECURITY]);
      if (path === `/repos/${REPO.id}/context/documents`) return Promise.resolve(DOCS_RESPONSE());
      if (path === `/agents/${AGENT.id}/context`) return Promise.resolve(computeEffective());
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
      // REPO2's own preview response — deliberately distinct body/tokens from
      // REPO's above so a test can tell "which repo's document actually
      // rendered" apart, not merely "a preview opened" (residual layer of the
      // same-path/different-repo bug family: previewing a row attached from a
      // non-active repo must render THAT repo's content, not the active
      // repo's content at the same path).
      if (path.startsWith(`/repos/${REPO2.id}/context/documents/preview?`)) {
        const qs = new URLSearchParams(path.split("?")[1]);
        const docPath = qs.get("path") ?? "";
        return Promise.resolve({
          path: docPath,
          body: `# ${docPath}\n\nrepo2 preview body`,
          tokens: 99,
          truncated: false,
          used_by_agents: 3,
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
    put: vi.fn((path: string, body: { documents: { repo_id: string; path: string }[] }) => {
      if (path !== `/agents/${AGENT.id}/context`) return Promise.reject(new Error(`unexpected PUT ${path}`));
      agentDirectRefs = body.documents;
      return Promise.resolve(computeEffective());
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
  usePathname: () => "/agents/ag1",
}));

import { RepoProvider } from "../../../../../../../lib/repo-context";
import { ContextTab } from "./ContextTab";

beforeEach(() => {
  agentDirectRefs = [];
  inherited = [];
  budgetTokens = 1000;
  driftedPaths = new Set();
  previousUnavailable = false;
  confirmCalls = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// `qc` is returned so a test can inspect the exact QueryClient instance the
// rendered tree is wired to (the preview cache-entry-identity tests need this
// — same pattern as the skill ContextTab's `renderTab`).
function renderTab() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <RepoProvider>
        <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: contextMessages }}>
          <ContextTab agent={AGENT} />
        </NextIntlClientProvider>
      </RepoProvider>
    </QueryClientProvider>,
  );
  return qc;
}

describe("ContextTab", () => {
  it("checking two documents renders a total equal to the sum of their estimates (AC-17, AC-40)", async () => {
    renderTab();
    const security = await screen.findByRole("checkbox", { name: /security-baseline\.md/ });
    fireEvent.click(security);
    await screen.findByText(/≈ 120 \/ 1000 tokens/);

    const publicApi = await screen.findByRole("checkbox", { name: /public-api\.md/ });
    fireEvent.click(publicApi);
    const total = await screen.findByText(/≈ \d+ \/ \d+ tokens/);
    expect(total).toHaveTextContent("≈ 210 / 1000 tokens");
  });

  it("attaching past the budget shows an over-budget state naming the same tail dropped_paths the API reports, and never disables attaching (AC-40, AC-41)", async () => {
    budgetTokens = 150;
    renderTab();

    fireEvent.click(await screen.findByRole("checkbox", { name: /security-baseline\.md/ }));
    await screen.findByText(/≈ 120 \/ 150 tokens/);

    fireEvent.click(await screen.findByRole("checkbox", { name: /public-api\.md/ }));
    await screen.findByText(/≈ 210 \/ 150 tokens/);

    expect(await screen.findByText("specs/public-api.md")).toBeInTheDocument();

    // The over-budget state is advisory only: attaching keeps working.
    const setup = await screen.findByRole("checkbox", { name: /setup\.md/ });
    expect(setup).not.toBeDisabled();
    fireEvent.click(setup);
    await screen.findByText(/≈ 260 \/ 150 tokens/);
  });

  it("typing 'sec' in the filter narrows visible rows, and clearing it restores previously-checked rows still checked (AC-18)", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("checkbox", { name: /public-api\.md/ }));
    await screen.findByText(/≈ 90 \/ 1000 tokens/);

    fireEvent.change(screen.getByPlaceholderText(contextMessages.filter.placeholder), { target: { value: "sec" } });
    expect(screen.getByText("security-baseline.md")).toBeInTheDocument();
    expect(screen.queryByText("public-api.md")).not.toBeInTheDocument();
    expect(screen.queryByText("setup.md")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(contextMessages.filter.placeholder), { target: { value: "" } });
    const publicApiCheckbox = await screen.findByRole("checkbox", { name: /public-api\.md/ });
    expect(publicApiCheckbox).toHaveAttribute("aria-checked", "true");
  });

  it("a document attached both directly and via a skill appears once, in the direct position (AC-16)", async () => {
    agentDirectRefs = [{ repo_id: REPO.id, path: "specs/public-api.md" }];
    inherited = [
      { repo_id: REPO.id, path: "specs/public-api.md", type: "specs", tokens: 90, source: "skill", skill_id: "sk1" },
      { repo_id: REPO.id, path: "specs/security-baseline.md", type: "specs", tokens: 120, source: "skill", skill_id: "sk1" },
    ];
    renderTab();

    // public-api.md is deduplicated into the direct (Attached) section only —
    // its filename appears exactly once across the whole tab.
    expect(await screen.findAllByText("public-api.md")).toHaveLength(1);
    expect(screen.queryByText("specs/public-api.md")).not.toBeInTheDocument();

    // security-baseline.md is still purely inherited, rendered read-only.
    expect(await screen.findByText("specs/security-baseline.md")).toBeInTheDocument();

    const attachedSection = screen.getByText("Attached documents").closest("div")!.parentElement!;
    expect(within(attachedSection).getByText("public-api.md")).toBeInTheDocument();
  });

  it("a drifted attached document's marker is clickable and opens the detail showing both versions (AC-38)", async () => {
    agentDirectRefs = [{ repo_id: REPO.id, path: "specs/public-api.md" }];
    driftedPaths = new Set(["specs/public-api.md"]);
    renderTab();

    const marker = await screen.findByRole("button", { name: contextMessages.drift.viewChange });
    fireEvent.click(marker);

    expect(await screen.findByText("old body text")).toBeInTheDocument();
    expect(await screen.findByText("new body text")).toBeInTheDocument();
  });

  it("a previous_unavailable drift response renders the note and still allows confirm (AC-38)", async () => {
    agentDirectRefs = [{ repo_id: REPO.id, path: "specs/public-api.md" }];
    driftedPaths = new Set(["specs/public-api.md"]);
    previousUnavailable = true;
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: contextMessages.drift.viewChange }));

    await screen.findByText(contextMessages.drift.detail.previousUnavailable);
    expect(screen.getByRole("button", { name: contextMessages.drift.detail.confirm })).toBeInTheDocument();
  });

  it("confirming a drift issues the mutation and clears the drift marker (AC-37)", async () => {
    agentDirectRefs = [{ repo_id: REPO.id, path: "specs/public-api.md" }];
    driftedPaths = new Set(["specs/public-api.md"]);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: contextMessages.drift.viewChange }));
    fireEvent.click(await screen.findByRole("button", { name: contextMessages.drift.detail.confirm }));

    await waitFor(() => expect(confirmCalls).toHaveLength(1));
    expect(confirmCalls[0]).toMatchObject({ owner_kind: "agent", owner_id: AGENT.id, path: "specs/public-api.md" });

    // The confirmed doc's marker is gone from the attached list once the
    // effective-context refetch (triggered by the mutation's cache
    // invalidation) lands.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: contextMessages.drift.viewChange })).not.toBeInTheDocument(),
    );
  });
  it("has no repository picker of its own — the repo comes from the shell", async () => {
    renderTab();
    await screen.findByRole("checkbox", { name: /specs\/public-api\.md/ });

    // A second, tab-local "current repo" is exactly what was removed: the only
    // repo this tab may attach from is the shell's active one.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/^Repository$/)).toBeNull();
    // …and it still says which repo it is browsing.
    expect(
      screen.getByText(fill(contextMessages.agentTab.browseTitle, { repo: REPO.full_name })),
    ).toBeInTheDocument();
  });

  it("previews a document in a right-side drawer, closable again", async () => {
    renderTab();

    const rows = await screen.findAllByRole("button", { name: contextMessages.attachments.preview });
    fireEvent.click(rows[0]!);

    // The Drawer is a modal dialog anchored to the right edge — not an inline
    // panel that pushes the list down.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await within(dialog).findByText(/rendered preview body/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers a drag handle on attached rows and no move arrows anywhere", async () => {
    agentDirectRefs = [{ repo_id: REPO.id, path: "specs/public-api.md" }];
    renderTab();

    await screen.findByRole("button", { name: /Reorder public-api\.md/ });
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });

  it("an agent with the same path attached from two different repos detaches only the clicked one (M1)", async () => {
    agentDirectRefs = [
      { repo_id: REPO.id, path: "specs/public-api.md" },
      { repo_id: REPO2.id, path: "specs/public-api.md" },
    ];
    renderTab();

    const checkboxes = await screen.findAllByRole("checkbox", { name: /public-api\.md/ });
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);

    // Losing BOTH on one click was the bug — exactly one attachment must
    // survive the PUT, not zero and not two.
    await waitFor(() => expect(agentDirectRefs).toHaveLength(1));
    expect(agentDirectRefs[0]?.path).toBe("specs/public-api.md");
  });

  it("clicking the SECOND of two same-path rows detaches the second document, not the first (M2, identity)", async () => {
    // Two rows share a path but come from different repos — rendered in
    // `agentDirectRefs` order, so checkboxes[0] is REPO's row and
    // checkboxes[1] is REPO2's row. A caller resolving "which repo_id was
    // clicked" by picking the FIRST match in `directDocs` order (the bug this
    // test guards against) would detach REPO's attachment regardless of which
    // row was actually clicked — a silent wrong-row action. Asserting on
    // WHICH repo_id survives (identity), not merely that exactly one
    // survived, is what tells the two implementations apart: both leave
    // exactly one ref, but only the fixed one leaves the RIGHT one.
    agentDirectRefs = [
      { repo_id: REPO.id, path: "specs/public-api.md" },
      { repo_id: REPO2.id, path: "specs/public-api.md" },
    ];
    renderTab();

    const checkboxes = await screen.findAllByRole("checkbox", { name: /public-api\.md/ });
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[1]!);

    await waitFor(() => expect(agentDirectRefs).toHaveLength(1));
    // The SECOND row (REPO2's attachment) must be the one removed — REPO's
    // survives. The first-match-wins bug would instead remove REPO's ref
    // and leave REPO2.id here.
    expect(agentDirectRefs[0]?.repo_id).toBe(REPO.id);
    expect(agentDirectRefs[0]?.path).toBe("specs/public-api.md");
  });

  it("previewing the SECOND of two same-path rows from different repos renders THAT repo's own document, not the active repo's (residual fix)", async () => {
    // Both rows attach "specs/public-api.md" — one from REPO (the active
    // repo), one from REPO2. Rendered in `agentDirectRefs` order, so the
    // FIRST preview button is REPO's row and the SECOND is REPO2's — same
    // ordering M1/M2 already rely on for the checkbox rows.
    agentDirectRefs = [
      { repo_id: REPO.id, path: "specs/public-api.md" },
      { repo_id: REPO2.id, path: "specs/public-api.md" },
    ];
    renderTab();

    const previewButtons = await screen.findAllByRole("button", { name: contextMessages.attachments.preview });
    fireEvent.click(previewButtons[1]!);

    const dialog = await screen.findByRole("dialog");
    // REPO2's content must render...
    await within(dialog).findByText(/repo2 preview body/);
    // ...and NEVER the active repo's (REPO's) content at the same path — the
    // exact failure mode this fix closes: showing the wrong file as if it
    // were the clicked one.
    expect(within(dialog).queryByText(/rendered preview body/)).not.toBeInTheDocument();
  });

  it("previews for the same path from two different repos are separate cache entries, not one shared entry (residual fix)", async () => {
    agentDirectRefs = [
      { repo_id: REPO.id, path: "specs/public-api.md" },
      { repo_id: REPO2.id, path: "specs/public-api.md" },
    ];
    const qc = renderTab();

    const previewButtons = await screen.findAllByRole("button", { name: contextMessages.attachments.preview });

    // Open REPO's row first, then close.
    fireEvent.click(previewButtons[0]!);
    await within(await screen.findByRole("dialog")).findByText(/rendered preview body/);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Then open REPO2's row.
    fireEvent.click(previewButtons[1]!);
    await within(await screen.findByRole("dialog")).findByText(/repo2 preview body/);

    // Both fetches must be sitting in the query cache SIMULTANEOUSLY, under
    // distinct keys — a shared/collapsed cache entry (the bug this closes)
    // would leave only one of these populated, or both holding the same body.
    const repoEntry = qc.getQueryData<{ body: string }>(["project-context-preview", REPO.id, "specs/public-api.md"]);
    const repo2Entry = qc.getQueryData<{ body: string }>([
      "project-context-preview",
      REPO2.id,
      "specs/public-api.md",
    ]);
    expect(repoEntry?.body).toMatch(/rendered preview body/);
    expect(repo2Entry?.body).toMatch(/repo2 preview body/);
    expect(repoEntry).not.toEqual(repo2Entry);
  });

  it("an inherited row resolves the skill's name instead of showing its raw skill_id (M4)", async () => {
    inherited = [
      {
        repo_id: REPO.id,
        path: "specs/security-baseline.md",
        type: "specs",
        tokens: 120,
        source: "skill",
        skill_id: SKILL_SECURITY.id,
      },
    ];
    renderTab();

    const path = await screen.findByText("specs/security-baseline.md");
    const row = path.closest('[role="listitem"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(new RegExp(SKILL_SECURITY.name))).toBeInTheDocument();
    // The raw uuid must never leak into the rendered text once a name resolves.
    expect(within(row as HTMLElement).queryByText(new RegExp(SKILL_SECURITY.id))).not.toBeInTheDocument();
  });
});
