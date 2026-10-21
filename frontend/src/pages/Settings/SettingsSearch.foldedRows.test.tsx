import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { SettingsSearch } from "./SettingsSearch";

vi.mock("../../store/persistSetting", () => ({ persistSetting: vi.fn() }));

const STRINGS: Record<string, string> = {
  "settings:externalServices.title": "Externe Dienste",
  "settings:search.keywords.externalServices": "Immich, Routing",
  "settings:search.expertKeywords.externalServices": "OpenRouteService-Schlüssel",
  "settings:security.title": "Sicherheit",
  "settings:search.keywords.security": "Passwort",
  "settings:search.label": "Einstellungen durchsuchen",
};
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => STRINGS[key] ?? opts?.defaultValue ?? key,
    i18n: { language: "de" },
  }),
}));

/**
 * beta.22 UAT: the hit for "OpenRouteService" opened the services page with
 * the routing group collapsed. A section that folds its rows gets the matched
 * word in the link, so it can open the row; other sections keep plain links.
 */
describe("SettingsSearch — sections that fold their rows", () => {
  const renderSearch = (): void => {
    render(
      <MemoryRouter>
        <SettingsSearch
          scopes={[
            {
              path: "/settings/services",
              label: "Dienste",
              sections: [
                {
                  id: "externalServices",
                  labelKey: "settings:externalServices.title",
                  keywordsKey: "settings:search.keywords.externalServices",
                  expertKeywordsKey: "settings:search.expertKeywords.externalServices",
                  expert: false,
                  foldsRows: true,
                },
              ],
            },
            {
              path: "/settings/account",
              label: "Konto",
              sections: [
                {
                  id: "security",
                  labelKey: "settings:security.title",
                  keywordsKey: "settings:search.keywords.security",
                  expert: false,
                },
              ],
            },
          ]}
        />
      </MemoryRouter>
    );
  };
  const box = () => screen.getByRole("searchbox", { name: "Einstellungen durchsuchen" });

  it("names the matched row in the link", () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: "openroute" } });
    expect(screen.getByRole("link", { name: /Externe Dienste/ })).toHaveAttribute(
      "href",
      "/settings/services?section=externalServices&match=OpenRouteService-Schl%C3%BCssel&expert=1"
    );
  });

  it("keeps a plain link for a section that does not fold its rows", () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: "passw" } });
    expect(screen.getByRole("link", { name: /Sicherheit/ })).toHaveAttribute(
      "href",
      "/settings/account?section=security"
    );
  });
});
