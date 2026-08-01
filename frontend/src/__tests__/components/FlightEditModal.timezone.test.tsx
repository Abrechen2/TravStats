import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fromZonedTime } from "date-fns-tz";
import type { Flight } from "../../types";

const mocks = vi.hoisted(() => ({ getByCode: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({
  default: () => null,
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
    // The browser's own timezone. Deliberately distinct from both airports
    // below — a half-hydrated value is invisible whenever two of the three
    // zones happen to agree.
    display: { timezone: "Europe/Berlin", language: "de" },
  }),
}));
// FlightEditModal imports airportsApi/tripsApi directly from their own
// modules (not the barrel), so those are the specifiers that must be mocked
// for the component's own calls to be intercepted.
vi.mock("../../lib/api/airports", () => ({
  airportsApi: { getByCode: mocks.getByCode },
}));
vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));
// CompanionPicker (rendered inside the modal) pulls companionsApi from the
// barrel — mock that separately so it doesn't fire a real request.
vi.mock("../../lib/api", () => ({
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
}));

import FlightEditModal from "../../components/FlightEditModal";

// A flight stored at 12:35/16:50 UTC, departing from an airport in Tokyo
// (UTC+9) and arriving in New York (UTC-4 in August). The browser (mocked
// above) runs in Berlin. All three zones differ on purpose.
const FLIGHT: Flight = {
  id: "f1",
  userId: "u1",
  airline: "ANA",
  flightNumber: "NH203",
  depLat: 35.5,
  depLon: 139.8,
  arrLat: 40.6,
  arrLon: -73.8,
  departureTime: "2026-08-14T12:35:00.000Z",
  arrivalTime: "2026-08-14T16:50:00.000Z",
  depIata: "HND",
  arrIata: "JFK",
  status: "scheduled",
  createdAt: "2026-01-01T00:00:00.000Z",
  companions: [],
  tags: [],
};

// 2026-08-14T12:35:00.000Z rendered in Asia/Tokyo (UTC+9, no DST).
const HYDRATED_DEPARTURE_INPUT = "2026-08-14T21:35";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getByCode.mockImplementation(async (code: string) =>
    code === "HND"
      ? { iata: "HND", timezone: "Asia/Tokyo", lat: 35.5, lon: 139.8 }
      : { iata: "JFK", timezone: "America/New_York", lat: 40.6, lon: -73.8 }
  );
});

describe("FlightEditModal timezone round trip", () => {
  it("does not move the stored instant when nothing is edited", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);

    // Wait for the airport timezones to resolve AND the inputs to be
    // rehydrated as airport-local (the departure input flips from the
    // browser-local seed to the Tokyo-local wall clock). Saving before this
    // point exercises the browser-local fallback branch instead.
    await waitFor(() => {
      const input = document.querySelector("#editDepartureTime") as HTMLInputElement;
      expect(input.value).toBe(HYDRATED_DEPARTURE_INPUT);
    });

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

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
