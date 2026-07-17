import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// The tiles do real file/API work — stub them to markers.
vi.mock("../../import/Fr24ImportTile", () => ({
  Fr24ImportTile: () => <div data-testid="tile-fr24" />,
}));
vi.mock("../../import/GenericCsvImportTile", () => ({
  GenericCsvImportTile: () => <div data-testid="tile-csv" />,
}));
vi.unmock("../../../store/settingsStore");

import ImportSection from "../ImportSection";
import { useSettingsStore } from "../../../store/settingsStore";

describe("ImportSection — central import hub", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ["flight", "cruise"] });
  });

  it("renders the flight group with exactly the two live tiles", () => {
    render(<ImportSection />);
    expect(screen.getByText("common:domain.flight")).toBeTruthy();
    expect(screen.getByTestId("tile-fr24")).toBeTruthy();
    expect(screen.getByTestId("tile-csv")).toBeTruthy();
  });

  it("renders no round-trip tile", () => {
    render(<ImportSection />);
    expect(screen.queryByText(/roundTrip|reimport/i)).toBeNull();
  });

  it("renders no group for a domain without bulk importers (cruise)", () => {
    render(<ImportSection />);
    expect(screen.queryByText("common:domain.cruise")).toBeNull();
  });

  it("hides the flight group when the flight domain is disabled", () => {
    useSettingsStore.setState({ enabledDomains: ["cruise"] });
    render(<ImportSection />);
    expect(screen.queryByTestId("tile-fr24")).toBeNull();
    expect(screen.queryByText("common:domain.flight")).toBeNull();
  });
});
