import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The export had no sheet for trips, bookings, place lists or documents: the
 * button never asked for them. Pinned at the button, because the sheet specs
 * can be right while the section never fetches the rows.
 */

const { exportMock, bookingsMock, listsMock } = vi.hoisted(() => ({
  exportMock: vi.fn(),
  bookingsMock: vi.fn(),
  listsMock: vi.fn(),
}));

vi.mock("../../../lib/xlsx/exportAll", () => ({
  exportWorkbook: exportMock,
  exportFilename: () => "export.xlsx",
}));
vi.mock("../../../lib/api/flights", () => ({ flightsApi: { getEvery: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/cruise", () => ({ cruiseApi: { list: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/lodging", () => ({ listLodgings: vi.fn(async () => []) }));
vi.mock("../../../lib/api/places", () => ({ placesApi: { list: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { list: vi.fn(async () => []), get: vi.fn() },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { list: vi.fn(async () => []) } }));
vi.mock("../../../lib/api/tours", () => ({ toursApi: { get: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: {
    getEvery: vi.fn(async () => [{ id: "t1", name: "Japan" }]),
    listEveryBooking: bookingsMock,
  },
}));
vi.mock("../../../lib/api/documents", () => ({
  documentsApi: { listEvery: vi.fn(async () => [{ id: "d1" }]) },
}));
vi.mock("../../../lib/api/placeLists", () => ({ listPlaceLists: listsMock }));
let enabled: string[] = ["flight", "poi"];
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: (d: string) => enabled.includes(d) }),
}));

import SpreadsheetSection from "../SpreadsheetSection";

async function exportOnce() {
  exportMock.mockClear();
  exportMock.mockResolvedValue(null);
  render(<SpreadsheetSection part="export" />);
  fireEvent.click(screen.getAllByRole("button", { name: /excelexp\.btn/ })[0]);
  await waitFor(() => expect(exportMock).toHaveBeenCalled());
  return exportMock.mock.calls[0][1];
}

describe("the export button fetches the overview sheets", () => {
  it("hands the workbook trips, bookings, place lists (with entries) and documents", async () => {
    bookingsMock.mockResolvedValue([{ id: "b1", tripId: null }]);
    listsMock.mockResolvedValue([{ id: "l1", entries: [] }]);
    enabled = ["flight", "poi"];

    const input = await exportOnce();

    expect(input.trips).toEqual([{ id: "t1", name: "Japan" }]);
    expect(input.bookings).toEqual([{ id: "b1", tripId: null }]);
    expect(input.documents).toEqual([{ id: "d1" }]);
    expect(input.placeLists).toEqual([{ id: "l1", entries: [] }]);
    // Entries are what the list-entry sheet is built from.
    expect(listsMock).toHaveBeenCalledWith(true);
  });

  it("leaves place lists out while the places domain is off", async () => {
    listsMock.mockClear();
    enabled = ["flight"];

    const input = await exportOnce();

    expect(listsMock).not.toHaveBeenCalled();
    expect(input.placeLists).toEqual([]);
  });
});
