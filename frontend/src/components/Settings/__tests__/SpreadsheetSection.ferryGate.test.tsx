import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../lib/api/ferry", () => ({ ferryApi: { listAll: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { getEvery: vi.fn(async () => []) },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { list: vi.fn(async () => []) } }));
vi.mock("../../../lib/xlsx/exportAll", () => ({
  exportWorkbook: vi.fn(async () => null),
  exportFilename: () => "x.xlsx",
}));
vi.unmock("../../../store/settingsStore");

import SpreadsheetSection from "../SpreadsheetSection";
import { ferryApi } from "../../../lib/api/ferry";
import { exportWorkbook } from "../../../lib/xlsx/exportAll";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * Ferry crossings left beta on 2026-10-26 (owner) and follow the
 * user's domain choice alone: with it off the export neither asks for them
 * nor writes their sheet; with it on it carries them, beta switch or not.
 */
describe("Excel export — ferry domain", () => {
  beforeEach(() => {
    vi.mocked(ferryApi.listAll).mockClear();
    vi.mocked(exportWorkbook).mockClear();
  });

  const exportOnce = async (): Promise<void> => {
    render(<SpreadsheetSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "xlsx:export.button" })[0]);
    await waitFor(() => expect(exportWorkbook).toHaveBeenCalled());
  };

  it("exports crossings with the beta switch off once the user has the domain on", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "ferry"], betaFeaturesEnabled: false });
    await exportOnce();
    expect(ferryApi.listAll).toHaveBeenCalledTimes(1);
  });

  it("leaves crossings out for a user who switched the domain off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    await exportOnce();
    expect(ferryApi.listAll).not.toHaveBeenCalled();
  });

  it("exports the crossings once the domain is on, and says which file is not a backup", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "ferry"], betaFeaturesEnabled: true });
    await exportOnce();
    expect(ferryApi.listAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText("xlsx:export.description")).toBeTruthy();
  });
});
