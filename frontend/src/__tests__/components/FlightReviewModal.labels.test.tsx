import { describe, it, expect, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

// Both airports resolve with their zone, so the save reaches `onConfirm`.
vi.mock("../../lib/api/airports", () => ({
  airportsApi: {
    getByCode: vi.fn(async (code: string) => ({
      iata: code,
      icao: `E${code}`,
      name: code,
      lat: 48,
      lon: 11,
      timezone: "Europe/Berlin",
    })),
  },
}));
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
vi.mock("../../components/AirportAutocomplete", () => ({ default: () => null }));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../store/settingsStore", () => {
  const state = { features: { enableCostTracking: true }, baseCurrency: "EUR" };
  return {
    useSettingsStore: Object.assign(() => state, { getState: () => state }),
  };
});
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});
vi.mock("@/lib/api/suggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/suggestions")>();
  return {
    ...actual,
    suggestionsApi: {
      ...actual.suggestionsApi,
      aircraft: vi.fn().mockResolvedValue([]),
      airlines: vi.fn().mockResolvedValue([]),
    },
  };
});

const booking = {
  flightNumber: "LH2230",
  departureCode: "MUC",
  arrivalCode: "CDG",
  departureTime: "2025-07-10T10:00:00",
  arrivalTime: "2025-07-10T11:35:00",
} as unknown as ParsedBooking;

/**
 * Every label in the flight review names its control (browser check on
 * 2026-10-02 for forgejo#159: none of the sixteen did, so a screen reader read
 * the departure and arrival time pickers without a name, and
 * `getByLabelText("Abflugzeit")` found nothing).
 */
describe("FlightReviewModal — labels", () => {
  it("connects every label to its field, cost fields included", async () => {
    render(
      <FlightReviewModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialData={booking}
        source="email"
      />
    );
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    await act(() => new Promise((r) => setTimeout(r, 50)));

    const labels = Array.from(document.querySelectorAll("form label"));
    expect(labels.length).toBeGreaterThanOrEqual(16);
    const unnamed = labels
      .filter((label) => !(label as HTMLLabelElement).control)
      .map((label) => label.textContent?.trim());
    expect(unnamed).toEqual([]);
  });
});
