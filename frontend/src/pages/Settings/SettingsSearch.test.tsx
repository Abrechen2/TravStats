import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { SettingsSearch, type SearchableSection } from "./SettingsSearch";
import { useSettingsLevelStore } from "../../store/settingsLevelStore";

const persisted = vi.hoisted(() => vi.fn());
vi.mock("../../store/persistSetting", () => ({ persistSetting: persisted }));

const section = (id: string, labelKey: string, expert = false): SearchableSection => ({
  id,
  labelKey,
  keywordsKey: `settings:search.keywords.${id}`,
  expertKeywordsKey: `settings:search.expertKeywords.${id}`,
  expert,
});

/** Owner request 2026-09-24: the settings need a search. */

const STRINGS: Record<string, string> = {
  "settings:security.title": "Sicherheit",
  "settings:homeAirport.title": "Heimatflughafen",
  "settings:search.keywords.security": "Passwort, Passkey, 2FA",
  "settings:search.keywords.homeAirport": "Flughafen, Wohnort",
  "settings:search.label": "Einstellungen durchsuchen",
  "settings:search.noResults": "Nichts gefunden.",
  "settings:autoUpdate.title": "Automatische Updates",
  "settings:search.keywords.autoupdate": "Flugstatus, Gate",
  "settings:search.expertKeywords.autoupdate": "Abfrageintervall",
  "settings:defaults.title": "Standard-Werte",
  "settings:search.keywords.defaults": "Buchungsklasse",
  "settings:level.expert": "Experte",
};
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => STRINGS[key] ?? opts?.defaultValue ?? key,
    i18n: { language: "de" },
  }),
}));

function Where(): JSX.Element {
  const location = useLocation();
  const highlight = (location.state as { highlight?: string } | null)?.highlight ?? "";
  return (
    <p data-testid="where" data-highlight={highlight}>
      {location.pathname + location.search}
    </p>
  );
}

function renderSearch(): void {
  render(
    <MemoryRouter initialEntries={["/settings/flight"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SettingsSearch
                scopes={[
                  {
                    path: "/settings/account",
                    label: "Konto",
                    surfaceLabel: "Einstellungen",
                    sections: [section("security", "settings:security.title")],
                  },
                  {
                    path: "/settings/flight",
                    label: "Flug",
                    surfaceLabel: "Einstellungen",
                    sections: [
                      section("homeAirport", "settings:homeAirport.title"),
                      section("autoupdate", "settings:autoUpdate.title"),
                      section("defaults", "settings:defaults.title", true),
                    ],
                  },
                ]}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const box = () => screen.getByRole("searchbox", { name: "Einstellungen durchsuchen" });

describe("SettingsSearch", () => {
  beforeEach(() => {
    useSettingsLevelStore.setState({ level: "expert" });
    persisted.mockClear();
  });

  it("finds a section on ANOTHER page by a word inside it, and links there", () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: "passw" } });

    const hit = screen.getByRole("link", { name: /Sicherheit/ });
    // Which surface and page, as the prototype says it (forgejo#321).
    expect(hit).toHaveTextContent("Einstellungen › Konto · Passwort");
    expect(hit).toHaveAttribute("href", "/settings/account?section=security");
  });

  it("goes to the first hit on Enter and clears the box", () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: "flugh" } });
    fireEvent.keyDown(box(), { key: "Enter" });

    expect(screen.getByTestId("where")).toHaveTextContent("/settings/flight?section=homeAirport");
    expect(box()).toHaveValue("");
  });

  it("says so when nothing matches", () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: "quantenphysik" } });
    expect(screen.getByRole("status")).toHaveTextContent("Nichts gefunden.");
  });

  // forgejo#321: search always finds what the standard level hides, says so,
  // and opening such a hit switches to the expert view (prototype behaviour).
  it("switches to the expert view when an expert hit is opened, and marks the section", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderSearch();
    fireEvent.change(box(), { target: { value: "buchungskl" } });

    const hit = screen.getByRole("link", { name: /Standard-Werte/ });
    expect(hit).toHaveTextContent("Einstellungen › Flug · Buchungsklasse · Experte");
    expect(hit).toHaveAttribute("href", "/settings/flight?section=defaults");
    fireEvent.click(hit);

    expect(useSettingsLevelStore.getState().level).toBe("expert");
    expect(persisted).toHaveBeenCalledWith(
      { settingsLevel: "expert" },
      expect.any(Function),
      expect.any(String)
    );
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/flight?section=defaults");
    expect(screen.getByTestId("where")).toHaveAttribute("data-highlight", "defaults");
  });

  it("switches on Enter too, for a hit on an expert row inside a standard section", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderSearch();
    fireEvent.change(box(), { target: { value: "abfrage" } });
    const hit = screen.getByRole("link", { name: /Automatische Updates/ });
    expect(hit).toHaveTextContent("Abfrageintervall · Experte");
    expect(hit).toHaveAttribute("href", "/settings/flight?section=autoupdate&expert=1");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/settings/flight?section=autoupdate&expert=1"
    );
    expect(useSettingsLevelStore.getState().level).toBe("expert");
  });

  it("leaves the level alone for an ordinary hit", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderSearch();
    fireEvent.change(box(), { target: { value: "passw" } });
    fireEvent.click(screen.getByRole("link", { name: /Sicherheit/ }));
    expect(useSettingsLevelStore.getState().level).toBe("standard");
    expect(screen.getByTestId("where")).toHaveAttribute("data-highlight", "security");
  });
});
