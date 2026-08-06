import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidateDetail } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { composeSkillBody, ruleSlug } from "./helpers";

function candidate(over: Partial<ConventionCandidateDetail> = {}): ConventionCandidateDetail {
  return {
    id: "c1",
    rule: "Validate request payloads with a zod schema.",
    category: "typing",
    evidence_path: "src/user.ts",
    evidence_line: 3,
    evidence_snippet: "export const UserSchema = z.object({",
    confidence: 0.9,
    status: "accepted",
    accepted: true,
    skill_id: null,
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const createMutate = vi.fn();

vi.mock("../../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [{ id: "a1", name: "Security Reviewer" }],
  }),
}));

vi.mock("../../../../../../../../lib/hooks/conventions", () => ({
  useCreateSkillFromConventions: () => ({
    mutate: createMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CANDIDATES = [
  candidate(),
  candidate({
    id: "c2",
    rule: "Always use async/await instead of .then() chains.",
    category: "structure",
    evidence_path: "src/api/users.ts",
    evidence_line: 23,
    evidence_snippet: "const user = await getUser(id);",
  }),
];

function renderModal(candidates = CANDIDATES) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CreateSkillModal
        repoId="r1"
        repoName="payments-api"
        candidates={candidates}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("ruleSlug", () => {
  it("drops filler words and kebabs the rest", () => {
    expect(ruleSlug("Always use async/await instead of .then() chains.")).toBe(
      "async-await-then-chains",
    );
  });

  it("falls back rather than producing an empty heading", () => {
    expect(ruleSlug("Always use the")).toBe("convention");
  });
});

describe("composeSkillBody", () => {
  it("gives each rule a section, a citation and its snippet", () => {
    const body = composeSkillBody("payments-api-conventions", "payments-api", CANDIDATES);
    expect(body).toContain("# payments-api-conventions");
    expect(body).toContain("House conventions for `payments-api`.");
    expect(body).toContain("## async-await-then-chains");
    expect(body).toContain("Detected in `src/api/users.ts:23`:");
    expect(body).toContain("const user = await getUser(id);");
  });

  it("omits the line number when the candidate has none", () => {
    const body = composeSkillBody("x", "repo", [candidate({ evidence_line: null })]);
    expect(body).toContain("Detected in `src/user.ts`:");
    expect(body).not.toContain("src/user.ts:");
  });
});

describe("CreateSkillModal", () => {
  it("opens pre-filled from the repo name and the accepted count", () => {
    renderModal();
    expect(screen.getByDisplayValue("payments-api-conventions")).toBeDefined();
    expect(screen.getByDisplayValue("2 house conventions extracted from payments-api")).toBeDefined();
    expect(screen.getByText("payments-api-conventions.md")).toBeDefined();
  });

  it("says what it merged from", () => {
    renderModal();
    expect(screen.getByText(/Merged from/)).toBeDefined();
    expect(screen.getByText("2 accepted conventions")).toBeDefined();
  });

  it("sends the edited body verbatim, not a regenerated one", () => {
    renderModal();
    const body = screen.getByLabelText(messages.modal.bodyLabel);
    fireEvent.change(body, { target: { value: "# hand written\n- only this" } });
    fireEvent.click(screen.getByRole("button", { name: messages.modal.save }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({
      candidate_ids: ["c1", "c2"],
      name: "payments-api-conventions",
      body: "# hand written\n- only this",
      type: "convention",
      enabled: true,
      agent_id: null,
    });
  });

  it("attaches to the chosen agent", () => {
    renderModal();
    const agentSelect = screen
      .getAllByRole("combobox")
      .find((el) => (el as HTMLSelectElement).value === "");
    fireEvent.change(agentSelect!, { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: messages.modal.save }));

    expect(createMutate.mock.calls[0]![0]).toMatchObject({ agent_id: "a1" });
  });

  it("can create the skill disabled", () => {
    renderModal();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: messages.modal.save }));
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ enabled: false });
  });

  it("blocks saving with an empty name", () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("payments-api-conventions"), {
      target: { value: "  " },
    });
    const save = screen.getByRole("button", { name: messages.modal.save });
    expect(save.hasAttribute("disabled")).toBe(true);
  });
});
