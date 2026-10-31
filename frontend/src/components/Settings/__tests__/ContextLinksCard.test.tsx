import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { ContextLinksCard } from "../ContextLinksCard";
import de from "../../../i18n/resources/de/settings.json";
import en from "../../../i18n/resources/en/settings.json";

describe("ContextLinksCard — a setting that lives in its context, findable from Settings", () => {
  it("jumps to the live editor", () => {
    render(
      <MemoryRouter>
        <ContextLinksCard
          scope="privacy.encryptedGrants"
          links={[{ id: "grants", to: "/encrypted-share" }]}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "settings:contextLinks.open" })).toHaveAttribute(
      "href",
      "/encrypted-share"
    );
  });

  // Each new section's copy exists in both languages, row by row.
  it.each([
    ["views", "mapAppearance", ["routes", "layers"]],
    ["views", "dashboardAppearance", ["sections"]],
    ["views", "listAppearance", ["columns"]],
    ["privacy", "comparisonConsent", ["consent"]],
    ["privacy", "encryptedGrants", ["grants"]],
  ])("has DE and EN copy for %s.%s", (group, section, rows) => {
    type Node = { title: string; description: string } & Record<
      string,
      { title: string; sub: string }
    >;
    for (const copy of [de, en] as unknown as Array<Record<string, Record<string, Node>>>) {
      const node = copy[group][section];
      expect(node.title).toBeTruthy();
      expect(node.description).toBeTruthy();
      for (const row of rows) {
        expect(node[row].title).toBeTruthy();
        expect(node[row].sub).toBeTruthy();
      }
    }
  });
});
