import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * forgejo#169 — a trip whose only entry is a linked train ride: the trip page
 * said "Bahn – 1 Fahrt", the card "0 Einträge", even after a reload.
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
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => true }));
vi.mock("../../../hooks/useRentalVisible", () => ({ useRentalVisible: () => true }));
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

describe("TripCard entry count (forgejo#169)", () => {
  it("counts a linked train ride as an entry", () => {
    render(
      <MemoryRouter>
        <TripCard trip={trip({ railJourneys: 1 })} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText("trips:card.entries/1")).toBeInTheDocument();
  });

  it("counts rentals and roadtrips beside it", () => {
    render(
      <MemoryRouter>
        <TripCard
          trip={trip({ flights: 1, railJourneys: 1, rentalBookings: 1, roadtrips: 1 })}
          onOpen={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("trips:card.entries/4")).toBeInTheDocument();
  });
});
