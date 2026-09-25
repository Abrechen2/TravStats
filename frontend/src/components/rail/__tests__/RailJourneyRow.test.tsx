import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { RailJourneyRow } from "../RailJourneyRow";
import type { RailJourney } from "../../../types/rail";

const base = {
  id: "j1",
  userId: "u1",
  operator: null,
  trainCategory: "ICE",
  trainNumber: "696",
  depStationName: "Frankfurt",
  depStationCode: null,
  depStationId: null,
  depLat: 50.1,
  depLon: 8.66,
  depCountry: "DE",
  depTimezone: "Europe/Berlin",
  arrStationName: "Fulda",
  arrStationCode: null,
  arrStationId: null,
  arrLat: 50.55,
  arrLon: 9.68,
  arrCountry: "DE",
  arrTimezone: "Europe/Berlin",
  departureTime: "2026-09-26T04:15:00.000Z",
  arrivalTime: "2026-09-26T05:10:00.000Z",
  distanceKm: 88.4,
  distanceSource: "route",
  geometry: [
    [8.66, 50.1],
    [9.68, 50.55],
  ],
  geometrySource: "transitous",
  actualDepartureTime: null,
  actualArrivalTime: null,
  lookupProvider: "transitous",
  lookupRef: "trip",
  travelClass: null,
  coach: null,
  seat: null,
  bookingReference: null,
  price: null,
  currency: "EUR",
  status: "completed",
  delayMinutes: null,
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
  bookingId: null,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
} satisfies RailJourney;

describe("RailJourneyRow distance label", () => {
  it("says a distance runs along the traced line", () => {
    render(<RailJourneyRow journey={base} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/88 km \(rail:tracedLine\)/)).toBeInTheDocument();
  });

  it("still says a measured distance is a straight line", () => {
    render(
      <RailJourneyRow
        journey={{
          ...base,
          distanceSource: "great_circle",
          geometry: null,
          geometrySource: "straight",
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/88 km \(rail:straightLine\)/)).toBeInTheDocument();
  });
});
