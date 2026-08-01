/**
 * Characterization test for the edit modal's timezone round trip.
 *
 * The property under guard: opening the modal and saving without changing
 * anything must reproduce the exact same UTC instant. The payload is a
 * wall-clock string plus the zone it was rendered against, so the guard
 * recombines them and compares against the stored instant.
 *
 * Three distinct zones on purpose — browser Berlin, departure Tokyo, arrival
 * New York. A value that is half browser-local and half airport-local is
 * invisible wherever two of the three zones agree.
 */
process.env.TZ = "Europe/Berlin";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fromZonedTime } from "date-fns-tz";
import type { Flight } from "../../types";

const mocks = vi.hoisted(() => ({
  getByCode: vi.fn(),
  tripsGetAll: vi.fn(),
  companionsList: vi.fn(),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({ default: () => null }));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
    display: { timezone: "Europe/Berlin" },
  }),
}));
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.companionsList } }));
vi.mock("../../hooks/useSuggestions", () => ({
  useSuggestions: () => ({ airlines: [], aircraft: [] }),
}));
vi.mock("../../lib/api/airports", () => ({ airportsApi: { getByCode: mocks.getByCode } }));
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: mocks.tripsGetAll } }));

import FlightEditModal from "../../components/FlightEditModal";

// Stored at 12:35 UTC = 21:35 in Tokyo, and arriving 16:50 UTC = 12:50 in
// New York. Neither matches the browser's Berlin wall clock.
const FLIGHT: Flight = {
  id: "f1",
  userId: "u1",
  flightNumber: "NH203",
  airline: "ANA",
  departureTime: "2026-08-14T12:35:00.000Z",
  arrivalTime: "2026-08-14T16:50:00.000Z",
  depIata: "HND",
  arrIata: "JFK",
  depLat: 35.5,
  depLon: 139.8,
  arrLat: 40.6,
  arrLon: -73.8,
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mocks.companionsList.mockReset().mockResolvedValue([]);
  mocks.tripsGetAll.mockReset().mockResolvedValue([]);
  mocks.getByCode.mockReset().mockImplementation(async (code: string) =>
    code === "HND"
      ? { iata: "HND", timezone: "Asia/Tokyo", lat: 35.5, lon: 139.8 }
      : { iata: "JFK", timezone: "America/New_York", lat: 40.6, lon: -73.8 }
  );
});

describe("FlightEditModal timezone round trip", () => {
  it("does not move the stored instant when nothing is edited", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={vi.fn()} onSave={onSave} />);

    // Wait for the airport timezones to resolve and the inputs to be rehydrated
    // as airport-local. Saving before this point is a different code path.
    await waitFor(() =>
      expect(
        (document.querySelector("#editDepartureTime") as HTMLInputElement)?.value
      ).toBe("2026-08-14T21:35")
    );

    await userEvent.click(screen.getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];

    // The payload is a wall-clock string plus its zone. Recombining them must
    // reproduce the original instant exactly.
    expect(fromZonedTime(payload.departureLocal, payload.depTimezone).toISOString()).toBe(
      FLIGHT.departureTime
    );
    expect(fromZonedTime(payload.arrivalLocal, payload.arrTimezone).toISOString()).toBe(
      FLIGHT.arrivalTime
    );
  });
});
