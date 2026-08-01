/**
 * Characterization test for Task 3b (#199) — pins what the create path
 * submits for departure/arrival date+time TODAY, before FlightCompleteStep's
 * own date/time inputs are swapped onto the shared `<TimesFields>` component
 * (the same component FlightEditModal already renders, see Task 3).
 *
 * `buildFlightPayload` (departureLocal/depTimezone/arrivalLocal/arrTimezone)
 * lives entirely in this hook and is untouched by that swap — the swap only
 * changes which JSX renders the four `<input>` elements that call
 * setDepartureDate/setDepartureTime/setArrivalDate/setArrivalTime. So this
 * test passing, unedited, both before and after the swap is exactly what
 * proves the swap changed nothing. This is the create-side equivalent of
 * FlightEditModal.timezone.test.tsx (Task 1's guard).
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
  // A stable object, NOT a fresh literal per call — real Zustand hooks
  // return the same reference across renders unless the store actually
  // changes. A fresh literal here would re-trigger the hook's
  // `useEffect(..., [settings])` (which seeds departureDate/arrivalDate to
  // "today") on every render, silently overwriting the dates this test sets.
  const settings = {
    units: { currency: "EUR" },
    defaults: {},
    // Deliberately distinct from both airports below so a depTimezone that
    // silently fell back to the user's display zone instead of the
    // departure airport's own zone would be caught.
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

describe("useFlightForm departure/arrival time submit (Task 3b characterization)", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onSubmit.mockReset().mockResolvedValue(undefined);
  });

  it("submits departureLocal/depTimezone and arrivalLocal/arrTimezone for a filled date+time", async () => {
    const { result } = renderHook(() => useFlightForm(onSubmit, vi.fn()));

    // Setting departure+arrival airports plus a departure date/time trips
    // the hook's own "auto-suggest arrival time" effect (it fires whenever
    // arrivalDateSetRef hasn't been marked yet) — that effect overwrites
    // arrivalDate/arrivalTime itself, in a separate render, before this test
    // ever gets to set them. Flush that first, THEN set arrival date/time
    // explicitly (as if the user edited the suggestion), matching how a
    // real user's later edit sticks once arrivalDateSetRef flips to true.
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
    expect(payload.departureLocal).toBe("2026-08-14T14:35");
    expect(payload.depTimezone).toBe("Asia/Tokyo");
    expect(payload.arrivalLocal).toBe("2026-08-14T16:50");
    expect(payload.arrTimezone).toBe("America/New_York");
  });

  it("falls back to the 12:00 placeholder when a date is filled but the time is left empty", async () => {
    const { result } = renderHook(() => useFlightForm(onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("HND", "Asia/Tokyo"));
      result.current.setArrival(makeAirport("JFK", "America/New_York"));
      result.current.setDepartureDate("2026-08-14");
      result.current.setDepartureTime("");
      result.current.setArrivalDate("2026-08-14");
      result.current.setArrivalTime("");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.departureLocal).toBe("2026-08-14T12:00");
    expect(payload.depTimezone).toBe("Asia/Tokyo");
    expect(payload.arrivalLocal).toBe("2026-08-14T12:00");
    expect(payload.arrTimezone).toBe("America/New_York");
  });
});
