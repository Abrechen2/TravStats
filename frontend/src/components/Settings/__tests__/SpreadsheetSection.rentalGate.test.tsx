import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../lib/api/rental", () => ({ rentalApi: { listAll: vi.fn(async () => []) } }));
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
import { rentalApi } from "../../../lib/api/rental";
import { exportWorkbook } from "../../../lib/xlsx/exportAll";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * forgejo#267: rentals stay behind the `rentalDomain` beta switch AND the
 * user's domain choice — with either off the export neither asks for them
 * nor writes their sheet; with both on it carries them.
 */
describe("Excel export — rental domain", () => {
  beforeEach(() => {
    vi.mocked(rentalApi.listAll).mockClear();
    vi.mocked(exportWorkbook).mockClear();
  });

  const exportOnce = async (): Promise<void> => {
    render(<SpreadsheetSection />);
    fireEvent.click(screen.getAllByRole("button", { name: "xlsx:export.button" })[0]);
    await waitFor(() => expect(exportWorkbook).toHaveBeenCalled());
  };

  it("leaves rentals out while the beta switch is off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rental"], betaFeaturesEnabled: false });
    await exportOnce();
    expect(rentalApi.listAll).not.toHaveBeenCalled();
    expect(vi.mocked(exportWorkbook).mock.calls[0][1].rentals).toEqual([]);
  });

  it("leaves rentals out for a user who switched the domain off", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    await exportOnce();
    expect(rentalApi.listAll).not.toHaveBeenCalled();
  });

  it("exports the rentals once both allow it, and says which file is not a backup", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "rental"], betaFeaturesEnabled: true });
    await exportOnce();
    expect(rentalApi.listAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText("xlsx:export.description")).toBeTruthy();
  });
});
