import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { Sidebar } from "./Sidebar";
import type { ShellContext } from "./types";
import shellMessages from "../../../../messages/en/shell.json";

afterEach(cleanup);

const SENTINEL = "__SENTINEL_MULTI_AGENT_LABEL__";

/** Mirrors useShellContext's `navLabel` — a safe `t.has` lookup with a fallback. */
function Harness({ ctx }: { ctx: Omit<ShellContext, "navLabel"> }) {
  const t = useTranslations("shell");
  const navLabel = (key: string, fallback: string) => (t.has(`nav.${key}`) ? t(`nav.${key}`) : fallback);
  return <Sidebar ctx={{ ...ctx, navLabel }} />;
}

describe("Sidebar nav labels", () => {
  it("renders the catalogue's nav.multi-agent translation, not the nav.ts fallback label", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{
          shell: { ...shellMessages, nav: { ...shellMessages.nav, "multi-agent": SENTINEL } },
        }}
      >
        <Harness ctx={{ activeKey: "multi-agent" }} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(SENTINEL)).toBeInTheDocument();
    expect(screen.queryByText("Multi-Agent Review")).not.toBeInTheDocument();
  });
});
