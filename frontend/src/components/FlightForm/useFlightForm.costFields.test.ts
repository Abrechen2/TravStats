/**
 * Phase 2 Task 3 (#199) — the create hook gains taxes, fees and the receipt
 * URL, so a flight's cost can be recorded while adding it instead of saving
 * and reopening. Renders the real hook and asserts the payload handed to
 * onSubmit.
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

describe("useFlightForm cost fields (#199)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSubmit.mockResolvedValue(undefined);
  });

  it("submits taxes, fees and the uploaded receipt path", async () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

    act(() => {
      result.current.setDeparture(makeAirport("FRA"));
      result.current.setArrival(makeAirport("JFK"));
      result.current.setDepartureDate("2026-07-01");
      result.current.setArrivalDate("2026-07-01");
      result.current.setTaxes(30.5);
      result.current.setFees(12);
      result.current.setReceiptUrl("/uploads/receipts/r1.pdf");
    });

    await act(async () => {
      await result.current.handleSubmit(submitEvent());
    });

    expect(mocks.onSubmit).toHaveBeenCalledTimes(1);
    const payload = mocks.onSubmit.mock.calls[0][0];
    expect(payload.taxes).toBe(30.5);
    expect(payload.fees).toBe(12);
    expect(payload.receiptUrl).toBe("/uploads/receipts/r1.pdf");
  });

  it("omits all three when nothing was recorded", async () => {
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
    expect(payload.taxes).toBeUndefined();
    expect(payload.fees).toBeUndefined();
    expect(payload.receiptUrl).toBeUndefined();
  });
});
