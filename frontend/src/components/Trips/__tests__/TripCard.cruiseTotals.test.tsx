import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * A trip made only of cruises read "— km" and "— Gesamtkosten" on its card,
 * although the cruises carried prices and their legs carried distances. The
 * card summed flights and nothing else, so a trip with `flights: []` summed to
 * nothing at all.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
    enabledDomains: ["flight", "cruise"],
  },
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";

const cruiseOnlyTrip = {
  id: "t-cruise",
  name: "Nordland",
  status: "completed",
  countries: ["Norway"],
  bookings: [],
  flights: [],
  cruises: [
    {
      id: "c1",
      cruiseLine: "AIDA",
      startDate: null,
      endDate: null,
      status: "completed",
      shipId: null,
      price: 1290,
      currency: "EUR",
      bookingId: null,
      distanceKm: 3400,
    },
  ],
  tags: [],
  category: null,
  color: null,
  coverImageUrl: null,
  destinationLabel: null,
  startDate: null,
  endDate: null,
  _count: { flights: 0, cruises: 1 },
} as unknown as Trip;

function renderCard(trip: Trip): void {
  render(
    <MemoryRouter>
      <TripCard trip={trip} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} />
    </MemoryRouter>,
  );
}

describe("TripCard totals on a cruise-only trip", () => {
  it("counts the cruise price towards the trip total", () => {
    renderCard(cruiseOnlyTrip);
    expect(screen.getByText(/1\.?290/)).toBeInTheDocument();
  });

  it("counts the cruise distance towards the trip kilometres", () => {
    renderCard(cruiseOnlyTrip);
    // formatDistance renders >= 1000 km as "3.4k"
    expect(screen.getByText("3.4k")).toBeInTheDocument();
  });

  it("adds cruise kilometres to flight kilometres on a mixed trip", () => {
    const mixed = {
      ...cruiseOnlyTrip,
      flights: [
        // Hamburg → Oslo, ~733 km great-circle.
        { id: "f1", depLat: 53.63, depLon: 9.99, arrLat: 60.19, arrLon: 11.1, bookingId: null },
      ],
      cruises: [{ ...(cruiseOnlyTrip.cruises ?? [])[0], distanceKm: 3400 }],
    } as unknown as Trip;

    renderCard(mixed);
    // 3400 + ~733 = ~4.1k, and no longer the cruise figure alone.
    expect(screen.queryByText("3.4k")).not.toBeInTheDocument();
    expect(screen.getByText("4.1k")).toBeInTheDocument();
  });

  it("still shows a dash when a cruise has neither price nor computed legs", () => {
    const bare = {
      ...cruiseOnlyTrip,
      cruises: [
        {
          id: "c2",
          cruiseLine: "AIDA",
          startDate: null,
          endDate: null,
          status: "completed",
          shipId: null,
          price: null,
          currency: "EUR",
          bookingId: null,
          distanceKm: 0,
        },
      ],
    } as unknown as Trip;

    renderCard(bare);
    expect(screen.queryByText(/1\.?290/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
