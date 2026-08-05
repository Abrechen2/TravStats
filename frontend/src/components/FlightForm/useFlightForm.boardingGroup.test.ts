/**
 * Phase 2 Task 6 (#199) — the boarding group in the CREATE path. The edit
 * modal has carried this field end to end all along; the create hook never
 * knew it, so a boarding group read out of a booking mail was silently
 * dropped on the way in.
 *
 * The empty case is the one that matters: an empty string would overwrite a
 * parser-provided value with nothing — the field must be OMITTED instead.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Airport } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  onSubmit: vi.fn(),
  createBatch: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  airportsApi: { getByCode: vi.fn() },
}));

vi.mock("../../lib/api/flights", () => ({
  flightsApi: { createBatch: mocks.createBatch },
}));

vi.mock("../../lib/api/trips", () => ({
  tripsApi: { assignFlights: vi.fn() },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" }, ready: true }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    units: { currency: "EUR" },
    defaults: {},
    display: { timezone: "Europe/Berlin" },
    features: {},
  }),
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
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

function makeAirport(iata: string): Airport {
  return {
    iata,
    icao: `X${iata}`,
    name: `${iata} Airport`,
    lat: 50,
    lon: 8,
    timezone: "Europe/Berlin",
  } as Airport;
}

function submitEvent(): React.FormEvent {
  return { preventDefault: () => {} } as React.FormEvent;
}

describe("useFlightForm boarding group (#199)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSubmit.mockResolvedValue(undefined);
  });

  it("carries a filled boarding group in the create payload", async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
      result.current.setBoardingGroup("A");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.onSubmit.mock.calls[0][0].boardingGroup).toBe("A");
  });

  it("omits it — undefined, not empty string — when the field is not filled", async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
      result.current.setBoardingGroup("");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.boardingGroup).toBeUndefined();
    expect("boardingGroup" in payload && payload.boardingGroup === "").toBe(false);
  });
});
