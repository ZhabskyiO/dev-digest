import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CommunitySkill, SkillImportPreview } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

const PREVIEW: SkillImportPreview = {
  name: "no-console-log",
  description: "Flags console.log left in production code.",
  type: "convention",
  body: "# No console.log\nFlag it.",
  source: "manual",
  skipped: [],
  warnings: [],
};

const COMMUNITY: CommunitySkill[] = [
  { name: "Conventional Commits", repo: "conventional-commits/conventionalcommits.org", stars: 8200, lang: "any", desc: "Commit message convention." },
];

const mutateAsyncPreview = vi.fn();
const mutateAsyncCreate = vi.fn();

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useImportPreview: () => ({ mutateAsync: mutateAsyncPreview, isPending: false, error: null, isError: false, reset: vi.fn() }),
  useCreateSkill: () => ({ mutateAsync: mutateAsyncCreate, isPending: false, error: null, isError: false }),
  useCommunitySkills: () => ({ data: COMMUNITY, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { AddSkillDrawer } from "./AddSkillDrawer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(initialTab: "file" | "url" | "community" = "file") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <AddSkillDrawer initialTab={initialTab} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("AddSkillDrawer (smoke)", () => {
  it("file tab: paste -> preview -> confirm creates a disabled skill", async () => {
    mutateAsyncPreview.mockResolvedValueOnce(PREVIEW);
    mutateAsyncCreate.mockResolvedValueOnce({ ...PREVIEW, id: "sk1", enabled: false, version: 1 });
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <AddSkillDrawer initialTab="file" onClose={onClose} />
      </NextIntlClientProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText(/Describe the rule/), {
      target: { value: "# No console.log\nFlag it." },
    });
    fireEvent.click(screen.getByText("Import skill"));

    await waitFor(() => expect(mutateAsyncPreview).toHaveBeenCalledWith({
      source: "file",
      filename: "pasted-skill.md",
      content_b64: expect.any(String),
    }));

    // Preview panel now shows the candidate name.
    expect(await screen.findByDisplayValue("no-console-log")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add skill"));

    await waitFor(() =>
      expect(mutateAsyncCreate).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, source: "manual", body: PREVIEW.body }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("url tab: entering a URL and importing calls the preview mutation with source 'url'", async () => {
    mutateAsyncPreview.mockResolvedValueOnce({ ...PREVIEW, source: "imported_url" });
    renderWithIntl("url");

    fireEvent.change(screen.getByPlaceholderText(/raw\.githubusercontent/), {
      target: { value: "https://example.com/skills/security.md" },
    });
    fireEvent.click(screen.getByText("Import from URL"));

    await waitFor(() =>
      expect(mutateAsyncPreview).toHaveBeenCalledWith({
        source: "url",
        url: "https://example.com/skills/security.md",
      }),
    );
  });

  it("community tab: lists catalog results and imports the clicked entry by its repo id", async () => {
    mutateAsyncPreview.mockResolvedValueOnce({ ...PREVIEW, source: "community" });
    renderWithIntl("community");

    expect(screen.getByText("Conventional Commits")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Import"));

    await waitFor(() =>
      expect(mutateAsyncPreview).toHaveBeenCalledWith({
        source: "community",
        id: "conventional-commits/conventionalcommits.org",
      }),
    );
  });

  it("shows the advisory risk panel when the preview carries warnings", async () => {
    mutateAsyncPreview.mockResolvedValueOnce({
      ...PREVIEW,
      warnings: ["instruction_override", "external_url"],
    });
    renderWithIntl("url");

    fireEvent.change(screen.getByPlaceholderText(/raw\.githubusercontent/), {
      target: { value: "https://example.com/skills/security.md" },
    });
    fireEvent.click(screen.getByText("Import from URL"));

    await waitFor(() => expect(screen.getByText(messages.risks.heading)).toBeInTheDocument());
    expect(screen.getByText(messages.risks.instruction_override)).toBeInTheDocument();
    expect(screen.getByText(messages.risks.external_url)).toBeInTheDocument();
    // Not a gate — the confirm action stays available.
    expect(screen.getByText(messages.file.confirm)).toBeInTheDocument();
  });

  it("omits the risk panel for a clean body", async () => {
    mutateAsyncPreview.mockResolvedValueOnce(PREVIEW);
    renderWithIntl("url");

    fireEvent.change(screen.getByPlaceholderText(/raw\.githubusercontent/), {
      target: { value: "https://example.com/skills/security.md" },
    });
    fireEvent.click(screen.getByText("Import from URL"));

    await waitFor(() => expect(screen.getByText(messages.file.previewHeading)).toBeInTheDocument());
    expect(screen.queryByText(messages.risks.heading)).toBeNull();
  });
});
