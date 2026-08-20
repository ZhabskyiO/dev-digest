import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/onboarding.json";
import { SectionCard } from "./SectionCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SectionCard", () => {
  it("renders the catalogue-derived heading keyed by kind and keeps its TOC anchor id", () => {
    const { container } = renderWithIntl(
      <SectionCard kind="architecture" icon="GitBranch" isEmpty={false}>
        <p>body content</p>
      </SectionCard>,
    );
    expect(screen.getByText("Architecture overview")).toBeInTheDocument();
    expect(container.querySelector("#architecture")).toBeInTheDocument();
  });

  it("collapses without removing the section (and its TOC anchor) from the DOM (AC-37)", () => {
    const { container } = renderWithIntl(
      <SectionCard kind="architecture" icon="GitBranch" isEmpty={false}>
        <p>body content</p>
      </SectionCard>,
    );
    expect(screen.getByText("body content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Toggle Architecture overview section/i }));
    expect(screen.queryByText("body content")).not.toBeInTheDocument();
    // The anchor the TOC scrolls to survives the collapse.
    expect(container.querySelector("#architecture")).toBeInTheDocument();
  });

  it("names its target in the collapse control's accessible name (AC-47)", () => {
    renderWithIntl(
      <SectionCard kind="critical_paths" icon="Activity" isEmpty={false}>
        <p>x</p>
      </SectionCard>,
    );
    expect(screen.getByRole("button", { name: /Critical paths/i })).toBeInTheDocument();
  });

  it("renders the per-kind default reason line when empty and no reason code is set (AC-11)", () => {
    renderWithIntl(
      <SectionCard kind="reading_path" icon="ListChecks" isEmpty>
        <p>never shown</p>
      </SectionCard>,
    );
    expect(
      screen.getByText("No guided reading path was found in this repository."),
    ).toBeInTheDocument();
    expect(screen.queryByText("never shown")).not.toBeInTheDocument();
  });

  it("renders the machine-reason line when a reason code is set (AC-11)", () => {
    renderWithIntl(
      <SectionCard kind="critical_paths" icon="Activity" isEmpty emptyReasonCode="insufficient_grounding">
        <p>never shown</p>
      </SectionCard>,
    );
    expect(
      screen.getByText("Not enough grounded evidence was found to fill this section."),
    ).toBeInTheDocument();
  });
});
