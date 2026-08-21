import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/context.json";
import { DocumentPreview } from "./DocumentPreview";

afterEach(cleanup);

function renderPreview(body: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <DocumentPreview path="specs/security-baseline.md" body={body} tokens={139} usedByAgents={2} />
    </NextIntlClientProvider>,
  );
}

describe("DocumentPreview", () => {
  it("renders untrusted markdown as inert text — no rehype-raw, so embedded HTML never becomes a real element", () => {
    const untrusted = "Safe heading\n\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\nMore safe text";
    const { container } = renderPreview(untrusted);

    // The point of AC-10 + the security note: a third-party document body can
    // never inject a real <script> or an auto-firing <img onerror>.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    // react-markdown (no rehype-raw) escapes raw HTML lines to literal text
    // rather than silently dropping them — still visible, just inert.
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(screen.getByText("Safe heading")).toBeInTheDocument();
    expect(screen.getByText("More safe text")).toBeInTheDocument();
  });

  it("shows the token estimate as an approximation and the used-by-agents count", () => {
    renderPreview("# Title\n\nBody.");
    expect(screen.getByText("≈ 139 tokens")).toBeInTheDocument();
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
  });
});
