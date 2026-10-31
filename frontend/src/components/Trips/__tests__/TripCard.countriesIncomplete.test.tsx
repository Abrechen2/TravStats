import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * GET /trips derives a card's countries from flights capped per trip; a capped
 * trip must say its country list may be incomplete instead of showing it as whole.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
    enabledDomains: ["flight", "rail", "rental", "roadtrip"],
  },
}));
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));
// Roadtrips sit behind the instance beta switch; open it, as on the beta.
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";

const trip = (count: Record<string, number>): Trip =>
  ({
    id: "t1",
    name: "QA Herbstreise",
    status: "planned",
    countries: [],
    bookings: [],
    flights: [],
    cruises: [],
    tags: [],
    category: null,
    color: null,
    coverImageUrl: null,
    destinationLabel: null,
    startDate: null,
    endDate: null,
    _count: { flights: 0, cruises: 0, lodgingStays: 0, routes: 0, photos: 0, ...count },
  }) as unknown as Trip;

describe("TripCard countries of a flight-capped trip", () => {
  const show = (t: Trip) =>
    render(
      <MemoryRouter>
        <TripCard trip={t} onOpen={() => {}} />
      </MemoryRouter>
    );

  it("says the countries may be incomplete when flightsTruncated", () => {
    show({ ...trip({ flights: 300 }), flightsTruncated: true });
    expect(screen.getByTestId("trip-card-countries-incomplete")).toHaveTextContent(
      "trips:card.countriesIncomplete"
    );
  });

  it("says nothing when the flights were not capped", () => {
    show({ ...trip({ flights: 3 }), flightsTruncated: false });
    expect(screen.queryByTestId("trip-card-countries-incomplete")).toBeNull();
  });
});
