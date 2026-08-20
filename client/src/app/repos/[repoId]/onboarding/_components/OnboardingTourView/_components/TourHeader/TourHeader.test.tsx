import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../../../messages/en/onboarding.json";
import commonMessages from "../../../../../../../../../messages/en/common.json";
import { TourHeader } from "./TourHeader";

afterEach(cleanup);

function tour(overrides: Partial<Onboarding> = {}): Onboarding {
  return {
    sections: [],
    generated_at: "2026-08-01T12:00:00Z",
    indexed_revision: "abc123",
    indexed_file_count: 12450,
    provider: "openai",
    model: "gpt-5",
    degraded_reason: null,
    ...overrides,
  };
}

function renderHeader(props: Partial<React.ComponentProps<typeof TourHeader>> = {}) {
  const defaults: React.ComponentProps<typeof TourHeader> = {
    repoFullName: "acme/payments-api",
    tour: tour(),
    state: "ready",
    stale: false,
    failureReason: null,
    failedDismissed: false,
    onDismissFailed: vi.fn(),
    regenerateDisabled: false,
    isGenerating: false,
    onRegenerate: vi.fn(),
    onShare: vi.fn(),
    shareCopied: false,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages, common: commonMessages }}>
      <TourHeader {...defaults} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("TourHeader", () => {
  it("renders 'Onboarding for payments-api' with the repo name distinguished (AC-35)", () => {
    renderHeader();
    const heading = screen.getByRole("heading", { level: 1 });
    // Sourced from the catalogue rather than restated as a literal here.
    expect(heading.textContent).toBe(`${onboardingMessages.headingPrefix}payments-api`);
    const span = heading.querySelector("span");
    expect(span?.textContent).toBe("payments-api");
  });

  it("builds the subtitle from indexed_file_count and generated_at, never hardcoded (AC-25)", () => {
    renderHeader({ tour: tour({ indexed_file_count: 12450 }) });
    expect(screen.getByText(/12450 files/)).toBeInTheDocument();
  });

  it("renders the stale marker alongside the subtitle when stale (AC-29)", () => {
    renderHeader({ stale: true });
    expect(
      screen.getByText(/generated before the latest repository index update/),
    ).toBeInTheDocument();
  });

  it("renders the degraded notice quoting its reason (AC-7)", () => {
    renderHeader({ tour: tour({ degraded_reason: "index_partial" }) });
    expect(screen.getByText(/generated from a partial index: index_partial/)).toBeInTheDocument();
  });

  it("disables Regenerate while a generation is in flight and shows the generating notice (AC-26, AC-27)", () => {
    renderHeader({ regenerateDisabled: true, isGenerating: true, state: "generating" });
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
    expect(screen.getByText(/Regenerating this tour in the background/)).toBeInTheDocument();
  });

  it("renders a dismissible failed notice naming the reason (AC-28)", () => {
    const onDismiss = vi.fn();
    renderHeader({ state: "failed", failureReason: "provider timeout", onDismissFailed: onDismiss });
    expect(screen.getByText(/last regeneration failed: provider timeout/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("hides the failed notice once dismissed", () => {
    renderHeader({ state: "failed", failureReason: "provider timeout", failedDismissed: true });
    expect(screen.queryByText(/last regeneration failed/)).not.toBeInTheDocument();
  });

  it("Regenerate and Share link are real buttons with accessible names (AC-47)", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share link" })).toBeInTheDocument();
  });

  it("calls onShare when Share link is activated and shows the copy confirmation", () => {
    const onShare = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider
        locale="en"
        messages={{ onboarding: onboardingMessages, common: commonMessages }}
      >
        <TourHeader
          repoFullName="acme/payments-api"
          tour={tour()}
          state="ready"
          stale={false}
          failureReason={null}
          failedDismissed={false}
          onDismissFailed={vi.fn()}
          regenerateDisabled={false}
          isGenerating={false}
          onRegenerate={vi.fn()}
          onShare={onShare}
          shareCopied={false}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    expect(onShare).toHaveBeenCalled();

    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ onboarding: onboardingMessages, common: commonMessages }}
      >
        <TourHeader
          repoFullName="acme/payments-api"
          tour={tour()}
          state="ready"
          stale={false}
          failureReason={null}
          failedDismissed={false}
          onDismissFailed={vi.fn()}
          regenerateDisabled={false}
          isGenerating={false}
          onRegenerate={vi.fn()}
          onShare={onShare}
          shareCopied
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });
});
