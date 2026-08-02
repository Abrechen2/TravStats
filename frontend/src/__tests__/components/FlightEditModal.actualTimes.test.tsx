/**
 * Coverage for Task 5 (#200) — actual departure/arrival wiring inside
 * FlightEditModal. Mirrors FlightEditModal.timezone.test.tsx's mocks and
 * fixture shape (that file is the standing guard for the SCHEDULED pair;
 * this is the analogous coverage for the ACTUAL pair, added alongside it
 * rather than strictly test-first for this file — the guard was written
 * and kept green first, then this was added to lock in the new behaviour).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    display: { timezone: "Europe/Berlin", language: "de" },
  }),
}));
vi.mock("../../lib/api/airports", () => ({
  airportsApi: { getByCode: mocks.getByCode },
}));
vi.mock("../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api", () => ({
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
}));

import FlightEditModal from "../../components/FlightEditModal";

const BASE_FLIGHT: Flight = {
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getByCode.mockImplementation(async (code: string) =>
    code === "HND"
      ? { iata: "HND", timezone: "Asia/Tokyo", lat: 35.5, lon: 139.8 }
      : { iata: "JFK", timezone: "America/New_York", lat: 40.6, lon: -73.8 }
  );
});

async function waitForHydration(): Promise<void> {
  await waitFor(() => {
    const dateInput = document.querySelector("#editDepartureDate") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-08-14");
  });
}

describe("FlightEditModal actual departure/arrival (#200)", () => {
  it("emits no actual*Local/actual*Tz fields when the flight never had an actual time and nothing is edited", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={BASE_FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.actualDepartureLocal).toBeUndefined();
    expect(payload.actualDepartureTz).toBeUndefined();
    expect(payload.actualArrivalLocal).toBeUndefined();
    expect(payload.actualArrivalTz).toBeUndefined();
  });

  it("round-trips an existing actual departure/arrival unedited, paired with the airport's own timezone", async () => {
    const flight: Flight = {
      ...BASE_FLIGHT,
      actualDeparture: "2026-08-14T13:05:00.000Z",
      actualArrival: "2026-08-14T17:20:00.000Z",
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={flight} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    await waitFor(() => {
      const actualDepDate = document.querySelector("#editActualDepartureDate") as HTMLInputElement;
      expect(actualDepDate.value).not.toBe("");
    });

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(
      fromZonedTime(payload.actualDepartureLocal, payload.actualDepartureTz).toISOString()
    ).toBe(flight.actualDeparture);
    expect(fromZonedTime(payload.actualArrivalLocal, payload.actualArrivalTz).toISOString()).toBe(
      flight.actualArrival
    );
    expect(payload.actualDepartureTz).toBe("Asia/Tokyo");
    expect(payload.actualArrivalTz).toBe("America/New_York");
  });

  it("filling in a previously-empty actual departure submits it paired with the departure airport's timezone", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={BASE_FLIGHT} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    const actualDepDateInput = document.querySelector(
      "#editActualDepartureDate"
    ) as HTMLInputElement;
    const actualDepTimeInput = document.querySelector(
      "#editActualDepartureTime"
    ) as HTMLInputElement;
    await userEvent.type(actualDepDateInput, "2026-08-14");
    await userEvent.type(actualDepTimeInput, "21:50");

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.actualDepartureLocal).toBe("2026-08-14T21:50");
    expect(payload.actualDepartureTz).toBe("Asia/Tokyo");
    // Arrival was never touched — still omitted entirely.
    expect(payload.actualArrivalLocal).toBeUndefined();
    expect(payload.actualArrivalTz).toBeUndefined();
  });

  // Three-way contract, third leg: blanking a RECORDED actual time submits
  // null — an explicit clear (the server resets delayMinutes with it).
  // Omitting the key instead would silently keep the stored actual time,
  // the same silent-keep family every other field was cured of on
  // 2026-08-02. The never-had case above stays an omit, so a no-op save
  // still emits no actual* keys at all.
  it("blanking a recorded actual departure/arrival submits null (explicit clear)", async () => {
    const flight: Flight = {
      ...BASE_FLIGHT,
      actualDeparture: "2026-08-14T13:05:00.000Z",
      actualArrival: "2026-08-14T17:20:00.000Z",
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FlightEditModal flight={flight} isOpen onClose={() => {}} onSave={onSave} />);
    await waitForHydration();

    await waitFor(() => {
      const actualDepDate = document.querySelector("#editActualDepartureDate") as HTMLInputElement;
      expect(actualDepDate.value).not.toBe("");
    });

    for (const id of [
      "#editActualDepartureDate",
      "#editActualDepartureTime",
      "#editActualArrivalDate",
      "#editActualArrivalTime",
    ]) {
      const input = document.querySelector(id) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "" } });
    }

    await userEvent.click(await screen.findByRole("button", { name: /speichern|save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.actualDepartureLocal).toBeNull();
    expect(payload.actualArrivalLocal).toBeNull();
    // No timezone accompanies a clear — the paired-timezone rule only
    // applies when a local string is present.
    expect(payload.actualDepartureTz).toBeUndefined();
    expect(payload.actualArrivalTz).toBeUndefined();
  });
});
