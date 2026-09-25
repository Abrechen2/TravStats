import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../lib/api/rail", () => ({ railApi: { listAll: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { getAll: vi.fn(async () => ({ flights: [] })) },
}));
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
 * Rail stays behind the `railDomain` beta gate (owner rule 2026-09-25): with
 * the gate off the export neither asks for the rides nor writes a rail sheet.
 */
describe("Excel export — rail beta gate", () => {
  beforeEach(() => {
    vi.mocked(railApi.listAll).mockClear();
    vi.mocked(exportWorkbook).mockClear();
  });

  it("leaves rail out while the gate is off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: false });
    render(<SpreadsheetSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "xlsx:export.button" })[0]);
    await waitFor(() => expect(exportWorkbook).toHaveBeenCalled());
    expect(railApi.listAll).not.toHaveBeenCalled();
    expect(vi.mocked(exportWorkbook).mock.calls[0][1].rail).toEqual([]);
  });

  it("exports the rides once the gate is on", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rail"], betaFeaturesEnabled: true });
    render(<SpreadsheetSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "xlsx:export.button" })[0]);
    await waitFor(() => expect(exportWorkbook).toHaveBeenCalled());
    expect(railApi.listAll).toHaveBeenCalledTimes(1);
  });
});
