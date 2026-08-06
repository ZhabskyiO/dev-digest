import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ModelInfo } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/agents.json";

// Hooks are mocked so the modal renders without a network or a query client.
const providerModels = vi.fn<(provider: string) => { data: ModelInfo[] | undefined }>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../../../../lib/hooks/agents", () => ({
  useCreateAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProviderModels: (provider: string) => providerModels(provider),
}));

import { CreateAgentModal } from "./CreateAgentModal";

const OPENAI_MODELS: ModelInfo[] = [
  { id: "gpt-4.1", provider: "openai" },
  { id: "gpt-4o-mini", provider: "openai" },
];

afterEach(() => {
  cleanup();
  providerModels.mockReset();
});

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <CreateAgentModal onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

/** The model picker is a custom dropdown — its trigger shows the current id. */
const openModelDropdown = () => fireEvent.click(screen.getByText("gpt-4.1"));

describe("CreateAgentModal model picker", () => {
  it("lists the provider's models in a dropdown instead of a text input", () => {
    providerModels.mockReturnValue({ data: OPENAI_MODELS });
    renderModal();

    openModelDropdown();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search models…")).toBeInTheDocument();
  });

  it("filters the list as you type", () => {
    providerModels.mockReturnValue({ data: OPENAI_MODELS });
    renderModal();

    openModelDropdown();
    fireEvent.change(screen.getByPlaceholderText("Search models…"), { target: { value: "mini" } });
    // Options are buttons; the closed-state trigger (a div) keeps showing the
    // current selection, so assert on the option list only.
    expect(screen.getByRole("button", { name: "gpt-4o-mini" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-4.1" })).not.toBeInTheDocument();
  });

  it("clears the model and blocks submit when the provider changes", () => {
    providerModels.mockReturnValue({ data: OPENAI_MODELS });
    renderModal();

    const create = screen.getByRole("button", { name: /Create agent/ });
    expect(create).not.toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("openai"), { target: { value: "anthropic" } });

    expect(screen.queryByText("gpt-4.1")).not.toBeInTheDocument();
    expect(screen.getByText("Search models…")).toBeInTheDocument(); // placeholder as value
    expect(create).toBeDisabled();
  });

  it("points at the API keys settings when the provider returns no models", () => {
    providerModels.mockReturnValue({ data: [] });
    renderModal();

    expect(
      screen.getByText("No models loaded — set the openai API key in Settings → API Keys."),
    ).toBeInTheDocument();
  });

  it("shows the generic hint while the list is still loading", () => {
    providerModels.mockReturnValue({ data: undefined });
    renderModal();

    expect(
      screen.getByText("Models are loaded dynamically from the provider's /models."),
    ).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument(); // default kept selectable
  });
});
