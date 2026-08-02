/**
 * Phase 2 Task 4 (#199) — assigning a trip while ADDING a flight. Previously
 * a new flight had to be saved and reopened in edit mode to join a trip.
 *
 * The ordering is the contract under test: Flight.tripId is owned by the
 * Trip relation, so the assignment runs as a SECOND call
 * (tripsApi.assignFlights) strictly AFTER a successful create — and a
 * failed create must not attempt it at all. This mirrors the edit modal's
 * deliberate save-then-assign ordering.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Airport } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  onSubmit: vi.fn(),
  createBatch: vi.fn(),
  addToast: vi.fn(),
  assignFlights: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  airportsApi: { getByCode: vi.fn() },
}));

vi.mock("../../lib/api/flights", () => ({
  flightsApi: { createBatch: mocks.createBatch },
}));

vi.mock("../../lib/api/trips", () => ({
  tripsApi: { assignFlights: mocks.assignFlights },
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

function fillMinimalFlight(result: {
  current: ReturnType<typeof useFlightForm>;
}): void {
  act(() => {
    result.current.setDeparture(makeAirport("FRA"));
    result.current.setArrival(makeAirport("JFK"));
    result.current.setDepartureDate("2026-07-01");
    result.current.setArrivalDate("2026-07-01");
  });
}

describe("useFlightForm trip assignment (#199)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSubmit.mockResolvedValue({ id: "flight-1" });
    mocks.assignFlights.mockResolvedValue(undefined);
  });

  it("assigns the created flight to the selected trip, strictly after the create", async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    fillMinimalFlight(result);
    act(() => {
      result.current.setTripId("trip-7");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.onSubmit).toHaveBeenCalledTimes(1);
    expect(mocks.assignFlights).toHaveBeenCalledWith("trip-7", {
      flightIds: ["flight-1"],
      action: "add",
    });
    // Strictly after: the assignment call must come later in the global
    // invocation order than the create.
    const createOrder = mocks.onSubmit.mock.invocationCallOrder[0];
    const assignOrder = mocks.assignFlights.mock.invocationCallOrder[0];
    expect(assignOrder).toBeGreaterThan(createOrder);
  });

  it("does not attempt the assignment when the create fails", async () => {
    mocks.onSubmit.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    fillMinimalFlight(result);
    act(() => {
      result.current.setTripId("trip-7");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.assignFlights).not.toHaveBeenCalled();
  });

  it("makes no assignment call when no trip is selected", async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    fillMinimalFlight(result);

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.onSubmit).toHaveBeenCalledTimes(1);
    expect(mocks.assignFlights).not.toHaveBeenCalled();
  });

  it("survives an onSubmit that returns nothing — older callers stay valid", async () => {
    mocks.onSubmit.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    fillMinimalFlight(result);
    act(() => {
      result.current.setTripId("trip-7");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    // No flight id → nothing to assign; the create itself succeeded.
    expect(mocks.assignFlights).not.toHaveBeenCalled();
  });

  it("a failed assignment surfaces a toast but does not fail the submit", async () => {
    mocks.assignFlights.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    fillMinimalFlight(result);
    act(() => {
      result.current.setTripId("trip-7");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    // The flight exists; the user is told the trip part failed.
    expect(mocks.addToast).toHaveBeenCalledWith("error", "flights:edit.tripAssignFailed");
    expect(result.current.error).toBe("");
  });
});
