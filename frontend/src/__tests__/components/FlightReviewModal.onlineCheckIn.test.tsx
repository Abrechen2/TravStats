import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

// forgejo#285: a parsed "online check-in opens" reaches the create request as
// the departure airport's wall clock, and an absent one sends nothing. Mocks
// as in the time-model suite, with both airports zoned.
vi.mock("../../lib/api/airports", () => ({
  airportsApi: {
    getByCode: vi.fn(async (code: string) => ({
      iata: code,
      icao: `K${code}`,
      name: code,
      lat: 40,
      lon: -73,
      timezone: code === "FRA" ? "Europe/Berlin" : "America/New_York",
    })),
  },
}));
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
// Its seeding poll is a timer this test is not about.
// It still shows its own field's error: an airport without a zone is refused
// AT that airport since forgejo#246.
vi.mock("../../components/AirportAutocomplete", () => ({
  default: ({ error }: { error?: string | null }) => (error ? <p>{error}</p> : null),
}));
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

const booking = (extra: Partial<ParsedBooking> = {}): ParsedBooking =>
  ({
    flightNumber: "LH400",
    departureCode: "FRA",
    arrivalCode: "JFK",
    departureTime: "2027-01-15T10:00",
    arrivalTime: "2027-01-15T13:00",
    ...extra,
  }) as unknown as ParsedBooking;

async function confirmWith(initialData: ParsedBooking) {
  const onConfirm = vi.fn();
  render(
    <FlightReviewModal
      isOpen
      onClose={vi.fn()}
      onConfirm={onConfirm}
      initialData={initialData}
      source="email"
    />
  );
  await waitFor(() => expect(document.querySelector('button[type="submit"]')).not.toBeDisabled());
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  return onConfirm.mock.calls[0][0];
}

describe("FlightReviewModal — online check-in (forgejo#285)", () => {
  it("shows the parsed opening and sends it as the departure airport's wall clock", async () => {
    const sent = await confirmWith(booking({ onlineCheckInOpensAt: "2027-01-14T10:00" }));
    expect(screen.getByLabelText(/Online-Check-in ab/)).toHaveValue("2027-01-14T10:00");
    expect(sent.onlineCheckInOpensAt).toEqual({ local: "2027-01-14T10:00" });
  });

  it("sends nothing when the document names none", async () => {
    const sent = await confirmWith(booking());
    expect(sent.onlineCheckInOpensAt).toBeUndefined();
  });
});
