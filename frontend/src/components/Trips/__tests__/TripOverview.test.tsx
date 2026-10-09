import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
// Shared trips (2026-10-09): the panel loads on its own and has its own
// suite (components/sharing/__tests__); here it would only race the assertions.
vi.mock("../../sharing/TripSharingPanel", () => ({ default: () => null }));

vi.mock("../../documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
// TripOverview renders the summary card, which asks the instance whether it
// has a text model at all (`GET /parser-capabilities`). The network guard
// fails any test that lets that request out (forgejo#110).
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));

vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => false }),
}));

// A trip's roadtrips come from their own endpoint; the stub hands them in.
const mockRoadtrips = vi.hoisted(() => vi.fn((): unknown[] => []));
vi.mock("../../Roadtrips/useTripRoadtrips", () => ({ useTripRoadtrips: () => mockRoadtrips() }));

// Rail and rental are beta areas; each test says whether they are on.
const visible = vi.hoisted(() => ({ rail: true, rental: true }));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => visible.rail }));
vi.mock("../../../hooks/useRentalVisible", () => ({ useRentalVisible: () => visible.rental }));

import TripOverview from "../TripOverview";

const t = ((key: string, opts?: { count?: number }) =>
  opts?.count !== undefined ? `${key}:${opts.count}` : key) as never;

function trip(overrides: Partial<Trip>): Trip {
  return {
    id: "trip-1",
    name: "Probe",
    startDate: null,
    endDate: null,
    status: "completed",
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    countries: [],
    flights: [],
    cruises: [],
    lodgingStays: [],
    bookings: [],
    ...overrides,
  } as Trip;
}

function renderOverview(value: Trip): void {
  render(
    <MemoryRouter>
      <TripOverview trip={value} t={t} language="de" onChanged={() => undefined} />
    </MemoryRouter>
  );
}

describe("TripOverview", () => {
  it("lists a roadtrip the trip holds as one of its entries, and says nothing is linked only when nothing is", () => {
    mockRoadtrips.mockReturnValueOnce([
      { id: "rt1", name: "Fjorde 2026", vehicle: "campervan", stopCount: 10, drivenKm: 1370.4 },
    ]);
    renderOverview(trip({}));
    expect(screen.getByText("Fjorde 2026").closest("a")).toHaveAttribute("href", "/roadtrips/rt1");
    expect(screen.queryByText("trips:detail.noLinks")).not.toBeInTheDocument();
  });

  // A trip holding only a train ride or a rental car said "nothing linked"
  // above an entry it was not showing (owner, 2026-10-01).
  it("lists a linked rental and a train ride, and then says nothing is missing", () => {
    renderOverview(
      trip({
        rentalBookings: [
          {
            id: "r1",
            provider: "Testcar",
            pickupStationName: "Testport A",
            returnStationName: "Testport B",
            pickupTime: "2026-07-02T08:30:00.000Z",
            returnTime: "2026-07-10T07:00:00.000Z",
            pickupTimezone: "Europe/Berlin",
            returnTimezone: "Europe/Berlin",
            pickupPrecision: "minute",
            returnPrecision: "minute",
            status: "completed",
          },
        ],
        railJourneys: [
          {
            id: "j1",
            operator: null,
            trainCategory: "ICE",
            trainNumber: "123",
            depStationName: "Teststadt Hbf",
            arrStationName: "Probeburg Hbf",
            depTimezone: "Europe/Berlin",
            arrTimezone: "Europe/Berlin",
            departureTime: "2026-07-01T08:00:00.000Z",
            arrivalTime: "2026-07-01T11:00:00.000Z",
            distanceKm: null,
            distanceSource: null,
            status: "completed",
            delayMinutes: null,
            price: null,
            currency: null,
            bookingId: null,
          },
        ],
      } as Partial<Trip>)
    );
    expect(screen.getByText(/Testcar/).closest("a")).toHaveAttribute("href", "/rentals/r1");
    expect(screen.getByText(/Teststadt Hbf/).closest("a")).toHaveAttribute("href", "/rail/j1");
    expect(screen.queryByText("trips:detail.noLinks")).not.toBeInTheDocument();
  });

  it("keeps a rental of a hidden beta area out — and then says nothing is linked", () => {
    visible.rental = false;
    try {
      renderOverview(
        trip({
          rentalBookings: [
            {
              id: "r1",
              provider: "Testcar",
              pickupStationName: "Testport A",
              returnStationName: "Testport A",
              pickupTime: "2026-07-02T08:30:00.000Z",
              returnTime: "2026-07-10T07:00:00.000Z",
              pickupTimezone: "Europe/Berlin",
              returnTimezone: "Europe/Berlin",
              pickupPrecision: "minute",
              returnPrecision: "minute",
              status: "completed",
            },
          ],
        })
      );
      expect(screen.queryByText(/Testcar/)).toBeNull();
      expect(screen.getByText("trips:detail.noLinks")).toBeInTheDocument();
    } finally {
      visible.rental = true;
    }
  });

  it("draws no figure for what the trip does not have", () => {
    // The old overview printed seven tiles, "0 Kreuzfahrten" and "0 Tags"
    // among them, for a trip without cruises or tags.
    renderOverview(trip({}));
    expect(screen.queryByText("trips:overview.daysAway")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:detail.stats.countries")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:totalCost")).not.toBeInTheDocument();
    expect(screen.getByText("trips:detail.noLinks")).toBeInTheDocument();
  });

  it("counts days inclusively and links each entry to its own page", () => {
    renderOverview(
      trip({
        startDate: "2025-07-12T00:00:00.000Z",
        endDate: "2025-07-28T00:00:00.000Z",
        countries: ["US", "CA"],
        flights: [
          {
            id: "f1",
            airline: "Lufthansa",
            flightNumber: "LH8462",
            depIata: "FRA",
            arrIata: "ANC",
            departureTime: "2025-07-12T10:00:00.000Z",
            status: "flown",
          },
        ] as Trip["flights"],
      })
    );
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    const row = screen.getByText("Lufthansa LH8462 · FRA → ANC").closest("a");
    expect(row).toHaveAttribute("href", "/flights/f1");
    // The user's date format (DD.MM.YYYY in the test store), not the ISO day.
    expect(row?.textContent).toContain("12.07.2025");
    expect(row?.textContent).not.toContain("2025-07-12");
  });
});
