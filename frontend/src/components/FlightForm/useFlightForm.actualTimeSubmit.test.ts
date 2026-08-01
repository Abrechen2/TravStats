/**
 * Coverage for Task 5 (#200) — actual departure/arrival submission from the
 * create-form hook. Mirrors useFlightForm.timeSubmit.test.ts's mocks and
 * fixture shape (Task 3b's guard for the SCHEDULED pair); this file is the
 * analogous test for the ACTUAL pair, asserting:
 *   - leaving the actual fields untouched emits no actualDepartureLocal /
 *     actualArrivalLocal at all (not "", not null) — a flight with no
 *     recorded actual time must stay that way.
 *   - filling them emits actualDepartureLocal/actualArrivalLocal paired with
 *     actualDepartureTz/actualArrivalTz, using the SAME buildLocalString the
 *     scheduled pair uses and the departure/arrival airport's own timezone
 *     (mirroring depTimezone/arrTimezone exactly).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Airport } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  airportsApi: { getByCode: vi.fn() },
}));

vi.mock("../../lib/api/flights", () => ({
  flightsApi: { createBatch: vi.fn() },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" }, ready: true }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../store/settingsStore", () => {
  const settings = {
    units: { currency: "EUR" },
    defaults: {},
    display: { timezone: "Europe/Berlin" },
    features: {},
  };
  return { useSettingsStore: () => settings };
});

vi.mock("../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

vi.mock("../../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn(() => ({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  })),
}));

import { useFlightForm } from "./useFlightForm";

function makeAirport(iata: string, timezone: string): Airport {
  return {
    iata,
    icao: `X${iata}`,
    name: `${iata} Airport`,
    lat: 50,
    lon: 8,
    timezone,
  } as Airport;
}

function submitEvent(): React.FormEvent {
  return { preventDefault: () => {} } as React.FormEvent;
}

describe("useFlightForm actual departure/arrival submit (#200)", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onSubmit.mockReset().mockResolvedValue(undefined);
  });

  it("emits no actual*Local/actual*Tz fields at all when the actual times are left untouched", async () => {
    const { result } = renderHook(() => useFlightForm(onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("HND", "Asia/Tokyo"));
      result.current.setArrival(makeAirport("JFK", "America/New_York"));
      result.current.setDepartureDate("2026-08-14");
      result.current.setDepartureTime("14:35");
    });
    act(() => {
      result.current.setArrivalDate("2026-08-14");
      result.current.setArrivalTime("16:50");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.actualDepartureLocal).toBeUndefined();
    expect(payload.actualDepartureTz).toBeUndefined();
    expect(payload.actualArrivalLocal).toBeUndefined();
    expect(payload.actualArrivalTz).toBeUndefined();
  });

  it("pairs actualDepartureLocal/actualArrivalLocal with the departure/arrival airport's own timezone when filled", async () => {
    const { result } = renderHook(() => useFlightForm(onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("HND", "Asia/Tokyo"));
      result.current.setArrival(makeAirport("JFK", "America/New_York"));
      result.current.setDepartureDate("2026-08-14");
      result.current.setDepartureTime("14:35");
    });
    act(() => {
      result.current.setArrivalDate("2026-08-14");
      result.current.setArrivalTime("16:50");
    });
    act(() => {
      result.current.setActualDepartureDate("2026-08-14");
      result.current.setActualDepartureTime("15:20");
      result.current.setActualArrivalDate("2026-08-14");
      result.current.setActualArrivalTime("17:05");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.actualDepartureLocal).toBe("2026-08-14T15:20");
    expect(payload.actualDepartureTz).toBe("Asia/Tokyo");
    expect(payload.actualArrivalLocal).toBe("2026-08-14T17:05");
    expect(payload.actualArrivalTz).toBe("America/New_York");
  });
});
