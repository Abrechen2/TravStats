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
  "settings:search.expertOnly": "Ansicht „Experte“",
  "settings:search.switchAndOpen": "Zu „Experte“ wechseln und öffnen",
};
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => STRINGS[key] ?? opts?.defaultValue ?? key,
    i18n: { language: "de" },
  }),
}));

function Where(): JSX.Element {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
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
                    sections: [section("security", "settings:security.title")],
                  },
                  {
                    path: "/settings/flight",
                    label: "Flug",
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
    expect(hit).toHaveTextContent("Konto · Passwort");
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

  // forgejo#321: search always finds what the standard level hides, and says so.
  it("finds an expert-only section at the standard level and offers to switch", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderSearch();
    fireEvent.change(box(), { target: { value: "buchungskl" } });

    const hit = screen.getByRole("link", { name: /Standard-Werte/ });
    expect(hit).toHaveTextContent("Ansicht „Experte“");
    expect(hit).toHaveAttribute("href", "/settings/flight?section=defaults");
    fireEvent.click(screen.getByRole("button", { name: "Zu „Experte“ wechseln und öffnen" }));

    expect(useSettingsLevelStore.getState().level).toBe("expert");
    expect(persisted).toHaveBeenCalledWith(
      { settingsLevel: "expert" },
      expect.any(Function),
      expect.any(String)
    );
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/flight?section=defaults");
  });

  it("marks a hit on an expert row inside a standard section as expert", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    renderSearch();
    fireEvent.change(box(), { target: { value: "abfrage" } });
    const hit = screen.getByRole("link", { name: /Automatische Updates/ });
    expect(hit).toHaveTextContent("Abfrageintervall · Ansicht „Experte“");
    // The link names the hidden row, so the page shows it (forgejo#321 review).
    expect(hit).toHaveAttribute("href", "/settings/flight?section=autoupdate&expert=1");
    expect(screen.getByRole("button", { name: /wechseln/ })).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/settings/flight?section=autoupdate&expert=1"
    );
  });

  it("offers no switch to an account already on the expert level", () => {
    renderSearch();
    fireEvent.change(box(), { target: { value: "buchungskl" } });
    expect(screen.getByRole("link", { name: /Standard-Werte/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wechseln/ })).toBeNull();
  });
});
