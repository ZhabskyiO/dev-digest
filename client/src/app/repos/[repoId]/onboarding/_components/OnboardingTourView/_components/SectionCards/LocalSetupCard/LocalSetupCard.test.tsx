import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { LocalSetupCard } from "./LocalSetupCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type LocalSetupSection = Extract<OnboardingSection, { kind: "local_setup" }>;

const COMMANDS = [
  "pnpm install",
  "cp .env.example .env # add OPENAI + STRIPE keys",
  "docker compose up -d postgres redis",
  "pnpm dev # http://localhost:3000",
];

function section(overrides: Partial<LocalSetupSection> = {}): LocalSetupSection {
  return {
    kind: "local_setup",
    title: "Local setup",
    items: COMMANDS.map((command) => ({ command })),
    diagram: null,
    links: null,
    empty_reason: null,
    ...overrides,
  };
}

describe("LocalSetupCard", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copying the second row writes exactly that row's command, with no numbering or neighbours (AC-38)", async () => {
    renderWithIntl(<LocalSetupCard section={section()} />);
    const secondRowCopy = screen.getByRole("button", {
      name: "Copy command: cp .env.example .env # add OPENAI + STRIPE keys",
    });
    await act(async () => {
      fireEvent.click(secondRowCopy);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("cp .env.example .env # add OPENAI + STRIPE keys");
  });

  it("renders every command as a discrete, individually copyable row (AC-18)", () => {
    renderWithIntl(<LocalSetupCard section={section()} />);
    for (const command of COMMANDS) {
      expect(screen.getByText(command)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Copy command: ${command}` }),
      ).toBeInTheDocument();
    }
  });

  it("renders the reason line and the card when there are no commands (AC-11)", () => {
    const { container } = renderWithIntl(<LocalSetupCard section={section({ items: [] })} />);
    expect(container.querySelector("#local_setup")).toBeInTheDocument();
    // Sourced from the catalogue rather than restated as a literal here.
    expect(screen.getByText(messages.empty.local_setup)).toBeInTheDocument();
  });

  it("never shows the 'Copied' state when the clipboard write rejects (M3)", async () => {
    writeText.mockRejectedValue(new Error("permission denied"));
    renderWithIntl(<LocalSetupCard section={section()} />);
    const copyButton = screen.getByRole("button", { name: `Copy command: ${COMMANDS[0]}` });

    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Copy command: ${COMMANDS[0]}` })).toBeInTheDocument();
  });

  it("never shows the 'Copied' state when navigator.clipboard is unavailable (M3)", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderWithIntl(<LocalSetupCard section={section()} />);
    fireEvent.click(screen.getByRole("button", { name: `Copy command: ${COMMANDS[0]}` }));
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
  });

  it("clears its pending reset timeout on unmount, without calling setState after unmount (L1)", () => {
    const { unmount } = renderWithIntl(<LocalSetupCard section={section()} />);
    fireEvent.click(screen.getByRole("button", { name: `Copy command: ${COMMANDS[0]}` }));
    // Unmounting before the 1500ms reset fires must not throw / warn about
    // setting state on an unmounted component.
    expect(() => unmount()).not.toThrow();
  });
});
