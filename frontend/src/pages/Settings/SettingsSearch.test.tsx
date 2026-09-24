import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { SettingsSearch } from "./SettingsSearch";

/** Owner request 2026-09-24: the settings need a search. */

const STRINGS: Record<string, string> = {
  "settings:security.title": "Sicherheit",
  "settings:homeAirport.title": "Heimatflughafen",
  "settings:search.keywords.security": "Passwort, Passkey, 2FA",
  "settings:search.keywords.homeAirport": "Flughafen, Wohnort",
  "settings:search.label": "Einstellungen durchsuchen",
  "settings:search.noResults": "Nichts gefunden.",
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
                  { route: "account", label: "Konto", sections: ["security"] },
                  { route: "flight", label: "Flug", sections: ["homeAirport"] },
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
});
