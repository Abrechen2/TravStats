import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

// Airport codes resolve through `getByCode` (lib/airportResolve); an unknown
// code is its 404 — the same "not found" the old empty search result gave.
// FRA carries its zone, JFK's record has none — the case under test.
vi.mock("../../lib/api/airports", () => ({
  airportsApi: {
    getByCode: vi.fn(async (code: string) => ({
      iata: code,
      icao: `K${code}`,
      name: code,
      lat: 40,
      lon: -73,
      ...(code === "FRA" ? { timezone: "Europe/Berlin" } : {}),
    })),
  },
}));
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
// Its seeding poll is a timer this test is not about.
vi.mock("../../components/AirportAutocomplete", () => ({ default: () => null }));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
// CHF, not EUR: the old literal would pass an EUR assertion by accident.
vi.mock("../../store/settingsStore", () => {
  const state = { features: { enableCostTracking: false }, baseCurrency: "CHF" };
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
  flightNumber: "LH400",
  departureCode: "FRA",
  arrivalCode: "JFK",
  departureTime: "2027-01-15T10:00:00Z",
  arrivalTime: "2027-01-15T13:00:00Z",
} as unknown as ParsedBooking;

/**
 * The parser review under the time model (ADR 0002, D2): a time is sent in
 * its airport's zone. An airport record without one used to borrow the
 * profile zone and then "UTC"; now the reader is told why nothing was saved.
 */
describe("FlightReviewModal — time model", () => {
  it("refuses an airport without a zone with the German reason", async () => {
    const onConfirm = vi.fn();
    render(
      <FlightReviewModal
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialData={booking}
        source="email"
      />
    );
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    // Let both airport codes resolve before submitting.
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByText(/keine Zeitzone bekannt/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
