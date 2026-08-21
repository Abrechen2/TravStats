/**
 * The create form's seat class and category selects gained an explicit
 * "(optional)" choice (parity with the edit modal, 2026-08-02). Pins the
 * wire contract: the empty choice submits null — an explicit "no value" —
 * never undefined, which would hand the decision to a server-side default
 * the user never picked. The defaulted path stays what it was: the
 * settings-driven values submit as-is.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Airport } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  onSubmit: vi.fn(),
  createBatch: vi.fn(),
  addToast: vi.fn(),
  // Mutable so individual tests can opt into a user-chosen default.
  settingsDefaults: {} as Record<string, string>,
}));

vi.mock("../../lib/api", () => ({
  airportsApi: { getByCode: vi.fn() },
}));

vi.mock("../../lib/api/flights", () => ({
  flightsApi: { createBatch: mocks.createBatch },
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
    defaults: mocks.settingsDefaults,
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

describe("useFlightForm optional seat class and category", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSubmit.mockResolvedValue(undefined);
    for (const key of Object.keys(mocks.settingsDefaults)) delete mocks.settingsDefaults[key];
  });

  it('submits null for both when "(optional)" is chosen', async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
      result.current.setSeatClass("");
      result.current.setCategory("");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.onSubmit).toHaveBeenCalledTimes(1);
    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.seatClass).toBeNull();
    expect(payload.category).toBeNull();
  });

  it("submits null for both when the user never touches them (no silent classification)", async () => {
    // Regression for #256: an untouched form used to store "economy" +
    // "business" the user never picked. With no settings default, both
    // fields start at "(optional)" and submit as an explicit null.
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.seatClass).toBeNull();
    expect(payload.category).toBeNull();
  });

  it("still applies a user-chosen settings default", async () => {
    mocks.settingsDefaults.seatClass = "premium_economy";
    mocks.settingsDefaults.flightCategory = "vacation";
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.seatClass).toBe("premium_economy");
    expect(payload.category).toBe("vacation");
  });
});
