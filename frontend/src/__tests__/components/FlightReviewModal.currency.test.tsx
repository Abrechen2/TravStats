import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

/**
 * A parsed booking without a price currency used to land on a literal "EUR",
 * whatever the account's own currency was. It now starts at the base currency,
 * and a currency the parser DID find still wins — that one is read off the
 * booking, not guessed.
 */
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
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
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
  departureAirport: { iata: "FRA", name: "Frankfurt" },
  arrivalAirport: { iata: "JFK", name: "New York" },
  departureTime: "2024-01-15T10:00:00Z",
  arrivalTime: "2024-01-15T13:00:00Z",
} as unknown as ParsedBooking;

function renderWith(data: ParsedBooking): void {
  render(
    <FlightReviewModal
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      initialData={data}
      source="email"
    />
  );
}

describe("FlightReviewModal — price currency", () => {
  it("starts in the account's base currency when the booking names none", async () => {
    renderWith(booking);
    await waitFor(() =>
      expect(screen.getByLabelText("common:currencySelect.label")).toHaveValue("CHF")
    );
  });

  it("keeps the currency the parser read off the booking", async () => {
    renderWith({ ...booking, currency: "usd" } as ParsedBooking);
    await waitFor(() =>
      expect(screen.getByLabelText("common:currencySelect.label")).toHaveValue("USD")
    );
  });
});
