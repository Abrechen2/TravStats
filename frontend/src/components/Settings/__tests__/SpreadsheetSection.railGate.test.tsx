import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../lib/api/rail", () => ({ railApi: { listAll: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { getEvery: vi.fn(async () => []) },
}));
// The gate on is also the roadtrips gate, which lets the tours in.
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { list: vi.fn(async () => []) } }));
vi.mock("../../../lib/xlsx/exportAll", () => ({
  exportWorkbook: vi.fn(async () => null),
  exportFilename: () => "x.xlsx",
}));
vi.unmock("../../../store/settingsStore");

import SpreadsheetSection from "../SpreadsheetSection";
import { railApi } from "../../../lib/api/rail";
import { exportWorkbook } from "../../../lib/xlsx/exportAll";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22): the export follows the
 * user's domain choice alone, whatever the instance's beta switch says.
 */
describe("Excel export — rail follows the domain choice", () => {
  beforeEach(() => {
    vi.mocked(railApi.listAll).mockClear();
    vi.mocked(exportWorkbook).mockClear();
  });

  it("leaves rail out while the user has the domain off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    render(<SpreadsheetSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "xlsx:export.button" })[0]);
    await waitFor(() => expect(exportWorkbook).toHaveBeenCalled());
    expect(railApi.listAll).not.toHaveBeenCalled();
    expect(vi.mocked(exportWorkbook).mock.calls[0][1].rail).toEqual([]);
  });

  it("exports the rides with the beta switch off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: false });
    render(<SpreadsheetSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "xlsx:export.button" })[0]);
    await waitFor(() => expect(exportWorkbook).toHaveBeenCalled());
    expect(railApi.listAll).toHaveBeenCalledTimes(1);
  });
});
