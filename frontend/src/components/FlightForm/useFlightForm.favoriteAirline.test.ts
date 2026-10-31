/** forgejo#389: Settings > Defaults > favourite airline changed nothing. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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

// The hook reads per-field selectors, so the mock must apply the selector to
// state whose members keep their identity across renders — a fresh `defaults`
// per call re-ran the defaults effect on every render and exhausted the heap.
const STABLE_FEATURES = {};
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: <T>(select: (s: unknown) => T): T =>
    select({ baseCurrency: "EUR", defaults: mocks.settingsDefaults, features: STABLE_FEATURES }),
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

describe("useFlightForm favourite airline default (forgejo#389)", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.settingsDefaults)) delete mocks.settingsDefaults[key];
  });

  it("prefills the airline field from the setting", () => {
    mocks.settingsDefaults.favoriteAirline = "Condor";
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    expect(result.current.airline).toBe("Condor");
  });

  it("keeps a typed airline when the defaults effect runs again", () => {
    mocks.settingsDefaults.favoriteAirline = "Condor";
    const { result, rerender } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    act(() => result.current.setAirline("Lufthansa"));
    mocks.settingsDefaults = { ...mocks.settingsDefaults };
    rerender();
    expect(result.current.airline).toBe("Lufthansa");
  });

  it("starts empty without a favourite", () => {
    const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));
    expect(result.current.airline).toBe("");
  });
});
