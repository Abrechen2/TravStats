import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
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
    expect(row?.textContent).toContain("2025-07-12");
  });
});
