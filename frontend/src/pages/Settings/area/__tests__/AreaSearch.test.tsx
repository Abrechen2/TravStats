import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AreaSearch, MAX_HITS } from "../AreaSearch";
import { searchArea } from "../areaSearch";
import { SETTINGS_REGISTRY } from "../../registry";
import { useSettingsStore } from "../../../../store/settingsStore";

vi.unmock("../../../../store/settingsStore");

function Where(): JSX.Element {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname + location.search + location.hash}|{JSON.stringify(location.state ?? null)}
    </p>
  );
}

const renderSearch = (isAdmin: boolean): void => {
  useSettingsStore.setState({ betaFeaturesEnabled: true, enabledDomains: ["flight", "cruise"] });
  render(
    <MemoryRouter initialEntries={["/settings/profil"]}>
      <AreaSearch isAdmin={isAdmin} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
};
const type = (value: string): void => {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
};

describe("the search box", () => {
  it("says '8 von N' when there are more hits than it lists, and lists eight", () => {
    renderSearch(true);
    type("en");
    expect(screen.getByTestId("settings-search-count")).toHaveTextContent(
      "settings:search.countMore"
    );
    // More hits exist than the list shows: the count line names both numbers.
    expect(
      searchArea(
        "en",
        SETTINGS_REGISTRY,
        {
          isAdmin: true,
          isDomainOn: () => true,
          isGateOpen: () => true,
        },
        "de"
      ).hits.length
    ).toBeGreaterThan(MAX_HITS);
    expect(within(screen.getByRole("list")).getAllByRole("link")).toHaveLength(MAX_HITS);
  });

  it("lets the person see every hit past the first eight ('8 von 72' had no way to the rest)", () => {
    renderSearch(true);
    type("en");
    const all = screen.getByTestId("settings-search-show-all");
    fireEvent.click(all);
    expect(screen.getByRole("list").querySelectorAll("a").length).toBeGreaterThan(MAX_HITS);
    expect(screen.queryByTestId("settings-search-show-all")).toBeNull();
    // A new query starts short again.
    type("eng");
    expect(screen.getByRole("list").querySelectorAll("a").length).toBeLessThanOrEqual(MAX_HITS);
  });

  it("says how many results there are when they all fit", () => {
    renderSearch(true);
    type("Geburtstagsflug");
    expect(screen.getByTestId("settings-search-count")).toHaveTextContent("settings:search.count");
    expect(screen.getByTestId("settings-search-count")).not.toHaveTextContent("countMore");
  });

  it("jumps to the hit: opens its page and row, and carries the section to highlight", () => {
    renderSearch(true);
    type("Vorname");
    fireEvent.click(screen.getAllByRole("link")[0]);
    expect(screen.getByTestId("where")).toHaveTextContent(
      '/settings/profil?match=vorname#profil-personliche-angaben|{"highlight":"profile"}'
    );
    // The box empties after a jump.
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("opens the first hit on Enter", () => {
    renderSearch(true);
    type("Vorname");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/settings/profil?match=vorname#profil-personliche-angaben"
    );
  });

  it("flags an expert hit and explains that opening it keeps the saved level", () => {
    renderSearch(true);
    type("Kontakt für Anfragen");
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("settings:level.expert");
    expect(screen.getByText("settings:search.expertNote")).toBeInTheDocument();
  });

  it("says nothing was found, with the words searched for", () => {
    renderSearch(false);
    type("qqzzxx");
    expect(screen.getByRole("status")).toHaveTextContent("settings:search.noResultsFor");
  });
});
