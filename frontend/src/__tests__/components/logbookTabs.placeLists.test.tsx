import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, update: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.unmock("../../store/settingsStore");

import LogbookTabs from "../../components/table/LogbookTabs";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Place lists and the UNESCO checklist were reachable only through a small
 * "Listen" button on /places — the feature's own author could not find them.
 * They get a tab beside "Orte", under the same visibility rule as that tab.
 */
describe("logbook tabs — place lists", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "poi"], betaFeaturesEnabled: true });
  });

  const renderAt = (path: string): void => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <LogbookTabs />
      </MemoryRouter>
    );
  };

  it("draws a Listen tab to /places/lists beside the places tab", () => {
    renderAt("/flights");
    expect(screen.getByRole("link", { name: /places:lists\.title/ })).toHaveAttribute(
      "href",
      "/places/lists"
    );
  });

  it("marks only the lists tab current on /places/lists", () => {
    renderAt("/places/lists");
    expect(screen.getByRole("link", { name: /places:lists\.title/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: /domain\.poi/ })).not.toHaveAttribute("aria-current");
  });

  it("draws no lists tab while the places area is not visible", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
    renderAt("/flights");
    expect(screen.queryByRole("link", { name: /places:lists\.title/ })).toBeNull();
  });
});
