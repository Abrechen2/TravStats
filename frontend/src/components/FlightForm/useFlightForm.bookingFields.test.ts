/**
 * Regression test for #197 — the manual "add flight" form dropped the
 * booking reference and ticket number: the hook had no state for either,
 * so the submit payload never carried them and users had to re-open the
 * flight in edit mode to fill them in.
 *
 * Renders the real hook and asserts the payload handed to onSubmit.
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

describe("useFlightForm booking fields (#197)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSubmit.mockResolvedValue(undefined);
  });

  it("includes bookingReference and ticketNumber in the submit payload", async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
      result.current.setBookingReference("9RFAA7");
      result.current.setTicketNumber("2202236084346");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.onSubmit).toHaveBeenCalledTimes(1);
    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.bookingReference).toBe("9RFAA7");
    expect(payload.ticketNumber).toBe("2202236084346");
  });

  it("omits both fields from the payload when left empty", async () => {
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

    expect(mocks.onSubmit).toHaveBeenCalledTimes(1);
    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.bookingReference).toBeUndefined();
    expect(payload.ticketNumber).toBeUndefined();
  });

  it("keeps the booking reference when preparing the return leg", async () => {
    const { result } = renderHook(() =>
      useFlightForm(mocks.onSubmit, vi.fn())
    );

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
      result.current.setBookingReference("9RFAA7");
    });

    await act(async () => {
      await result.current.handleSubmitAndReturn(submitEvent());
    });

    // Return-leg prep swaps airports but keeps booking-stable fields —
    // the return flight belongs to the same PNR.
    expect(result.current.bookingReference).toBe("9RFAA7");
    expect(result.current.departure?.iata).toBe("JFK");
    expect(result.current.arrival?.iata).toBe("FRA");
  });
});
