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
// It still shows its own field's error: an airport without a zone is refused
// AT that airport since forgejo#246.
vi.mock("../../components/AirportAutocomplete", () => ({
  default: ({ error }: { error?: string | null }) => (error ? <p>{error}</p> : null),
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (
    (state: Record<string, unknown>) => (select?: (s: Record<string, unknown>) => unknown) =>
      select ? select(state) : state
  )({ user: { id: "u1" } }),
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

/** What a boarding-pass scan delivers: the barcode's day, no clock, no arrival. */
const scanned = {
  flightNumber: "UA952",
  departureCode: "FRA",
  arrivalCode: "JFK",
  departureTime: "2016-01-08T00:00",
  inferredFields: ["departureTime"],
  missing: ["arrivalTime"],
} as unknown as ParsedBooking;

/** The input a label names (the copy button's title also starts with "Abflugdatum"). */
const input = (label: RegExp) =>
  screen.getAllByLabelText(label).find((el) => el.tagName === "INPUT") as HTMLInputElement;

/**
 * The scan review uses the flight form's date behaviour (owner, 2026-11-22):
 * the arrival date follows the departure date, so only the clock is typed.
 */
describe("FlightReviewModal — date carry-over in the scan result", () => {
  it("prefills the arrival date from the departure date and leaves both clocks to type", async () => {
    render(
      <FlightReviewModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialData={scanned}
        source="boardingpass"
      />
    );
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());

    expect(input(/^Abflugdatum/).value).toBe("2016-01-08");
    // T00:00 is the date-only placeholder, not a midnight departure.
    expect(input(/^Abflugzeit/).value).toBe("");
    expect(input(/^Ankunftsdatum/).value).toBe("2016-01-08");
    expect(input(/^Ankunftszeit/).value).toBe("");
  });

  it("moves the arrival date along when the departure date changes", async () => {
    render(
      <FlightReviewModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialData={scanned}
        source="boardingpass"
      />
    );
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());

    fireEvent.change(input(/^Abflugdatum/), { target: { value: "2016-01-09" } });

    expect(input(/^Ankunftsdatum/).value).toBe("2016-01-09");
  });

  it("offers the flight form's copy button for an arrival date set apart", async () => {
    render(
      <FlightReviewModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialData={{ ...scanned, arrivalTime: "2016-01-10T09:50" } as ParsedBooking}
        source="boardingpass"
      />
    );
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    expect(input(/^Ankunftsdatum/).value).toBe("2016-01-10");

    fireEvent.click(screen.getByTitle("Abflugdatum übernehmen"));

    expect(input(/^Ankunftsdatum/).value).toBe("2016-01-08");
    expect(input(/^Ankunftszeit/).value).toBe("09:50");
  });

  it("keeps a genuine 00:00 from a mail import", async () => {
    render(
      <FlightReviewModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        initialData={{ ...scanned, inferredFields: [] } as ParsedBooking}
        source="email"
      />
    );
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    expect(input(/^Abflugzeit/).value).toBe("00:00");
  });
});
