import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../TripMoreMenu", () => ({ default: () => <div>more-menu</div> }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => false }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import TripHead from "../TripHead";
import type { Trip } from "../../../types";
import type { TripPlaceVisit } from "../../../hooks/useTripPlaceVisits";

const t = ((key: string, o?: { count?: number }) => `${key}${o?.count ?? ""}`) as never;
const tv = (local: string, offset: string, zone: string) => ({
  utc: new Date(`${local}${offset}`).toISOString(),
  zone,
  offset,
  local,
  precision: "minute",
});
const trip = {
  id: "t1",
  name: "Lisbon",
  status: "completed",
  countries: [],
  companions: [],
  times: [],
  cruises: [],
  stops: [],
  flights: [
    {
      id: "f1",
      depIata: "BER",
      arrIata: "LIS",
      depLat: 52.36,
      depLon: 13.5,
      arrLat: 38.77,
      arrLon: -9.13,
      times: {
        departure: tv("2026-01-10T08:00:00", "+01:00", "Europe/Berlin"),
        arrival: tv("2026-01-10T10:30:00", "+00:00", "Europe/Lisbon"),
      },
    },
  ],
} as unknown as Trip;
const visit = {
  place: { id: "p", name: "p", lat: 38.69, lon: -9.2 },
  visit: {
    id: "v1",
    placeId: "p",
    visitedAt: "2026-01-10T09:00:00",
    times: { visitedAt: tv("2026-01-10T09:00:00", "+01:00", "Europe/Berlin") },
    orderIdx: 0,
  },
} as unknown as TripPlaceVisit;

const renderHead = (placeVisits?: TripPlaceVisit[]) =>
  render(
    <MemoryRouter>
      <TripHead
        trip={trip}
        locale="de"
        t={t}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onChanged={vi.fn()}
        placeVisits={placeVisits}
      />
    </MemoryRouter>
  );

describe("TripHead inconsistency count", () => {
  it("counts a visit during a flight, like the timeline does (forgejo#426)", () => {
    renderHead([visit]);
    expect(screen.getByTestId("trip-head-inconsistencies").textContent).toContain("1");
  });

  it("shows no count when there are no visits and no contradictions", () => {
    renderHead([]);
    expect(screen.queryByTestId("trip-head-inconsistencies")).toBeNull();
  });
});
