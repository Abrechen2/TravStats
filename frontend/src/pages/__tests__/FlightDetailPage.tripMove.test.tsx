/**
 * Review I1 (fix round 1): on the flight's page, a stored edit whose trip move
 * then fails must stay on screen with its retry — the page used to reload
 * under the dialog, unmount it, and bring it back fresh with the old trip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Flight } from "../../types";

const getById = vi.fn();
const update = vi.fn();
const assignFlights = vi.fn();

vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/flightTrack/FlightTrackSection", () => ({ default: () => null }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/SpecialFlightModal", () => ({ default: () => null }));
vi.mock("../../components/ReceiptUpload", () => ({ default: () => null }));
vi.mock("../../components/common/TripPhotoWindowStrip", () => ({ default: () => null }));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn().mockResolvedValue([]) },
  documentFileUrl: () => "",
}));
vi.mock("../../lib/api/flightBooking", () => ({ flightBookingApi: { get: vi.fn() } }));
vi.mock("../../lib/api", () => ({
  flightsApi: {
    getById: (...a: unknown[]) => getById(...a),
    update: (...a: unknown[]) => update(...a),
    getTrack: vi.fn().mockResolvedValue(null),
    delete: vi.fn(),
  },
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
  setupApi: { getAirportSeedingStatus: vi.fn().mockResolvedValue({ seeded: true }) },
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/lib/api/trips", () => ({
  tripsApi: {
    getAll: vi.fn().mockResolvedValue([
      { id: "t1", name: "Sommer" },
      { id: "t2", name: "Herbst" },
    ]),
    assignFlights: (...a: unknown[]) => assignFlights(...a),
  },
}));
vi.mock("../../lib/api/airports", () => ({
  airportsApi: { getByCode: vi.fn(async () => ({ timezone: "UTC" })) },
}));
vi.mock("../../lib/api/catalogue", () => ({
  airlinesApi: { search: vi.fn().mockResolvedValue([]) },
  aircraftApi: { search: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
// The edit form reads `features` off the store the suite stubs without them.
vi.mock("../../store/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../store/settingsStore")>();
  const state = {
    ...actual.useSettingsStore.getState(),
    features: { enableCostTracking: false },
    display: { language: "de", dateFormat: "DD.MM.YYYY", timeFormat: "24h" },
    units: { currency: "EUR", distanceUnit: "kilometers" },
  };
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
      { getState: () => state }
    ),
  };
});
vi.mock("@/hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));

import FlightDetailPage from "../FlightDetailPage";

const flight = {
  id: "f1",
  airline: "LH",
  flightNumber: "LH123",
  depIata: "FRA",
  arrIata: "MUC",
  depLat: 50,
  depLon: 8,
  arrLat: 48,
  arrLon: 11,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  tripId: "t1",
  createdAt: "2026-01-01T00:00:00.000Z",
} as Flight;

const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

describe("FlightDetailPage — a failed trip move after a stored edit", () => {
  beforeEach(() => {
    getById.mockReset().mockResolvedValue(flight);
    update.mockReset().mockResolvedValue({});
    assignFlights.mockReset().mockRejectedValueOnce(networkError).mockResolvedValue(undefined);
  });

  it("stays visible, and the retry moves the flight to the trip the user chose", async () => {
    render(
      <MemoryRouter initialEntries={["/flights/f1"]}>
        <Routes>
          <Route path="/flights/:id" element={<FlightDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: "common:buttons.edit" }));
    await waitFor(() => expect(document.querySelector('option[value="t2"]')).not.toBeNull());
    const tripSelect = document.querySelector('option[value="t2"]')!.closest("select")!;
    fireEvent.change(tripSelect, { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: "flights:edit.saveChanges" }));

    expect(await screen.findByText("flights:edit.savedTripAssignFailed")).toBeInTheDocument();
    // Nothing reloads under the open dialog.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText("flights:edit.savedTripAssignFailed")).toBeInTheDocument();
    expect(getById).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() =>
      expect(screen.queryByText("flights:edit.savedTripAssignFailed")).toBeNull()
    );
    expect(assignFlights).toHaveBeenLastCalledWith("t2", { flightIds: ["f1"], action: "add" });
    expect(update).toHaveBeenCalledTimes(1);
    // One reload, once the dialog closed.
    await waitFor(() => expect(getById).toHaveBeenCalledTimes(2));
  });
});
