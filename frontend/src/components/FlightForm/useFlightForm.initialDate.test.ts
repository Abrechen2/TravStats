/**
 * The gap calendar's "Eintrag anlegen" opens the add form on the stretch's
 * first day: without `initialDate` the form always started on today and the
 * dates the link carried were thrown away.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

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

// The hook reads per-field selectors, so the mock must apply the selector to
// state whose members keep their identity across renders — a fresh `defaults`
// per call re-ran the defaults effect on every render and exhausted the heap.
const STABLE_DEFAULTS = {};
const STABLE_FEATURES = {};
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: <T>(select: (s: unknown) => T): T =>
    select({ baseCurrency: "EUR", defaults: STABLE_DEFAULTS, features: STABLE_FEATURES }),
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

describe("useFlightForm — a day to open on", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts the departure and arrival dates on initialDate instead of today", () => {
    const { result } = renderHook(() =>
      useFlightForm(mocks.onSubmit, vi.fn(), undefined, "2024-03-04")
    );
    expect(result.current.departureDate).toBe("2024-03-04");
    expect(result.current.arrivalDate).toBe("2024-03-04");
  });

  it("without initialDate it still starts on today", () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    expect(result.current.departureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.departureDate).not.toBe("2024-03-04");
  });
});
