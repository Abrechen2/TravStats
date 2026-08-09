import type { Flight } from "@prisma/client";

import { createFlightSchema } from "../../schemas/flight";
import { buildFlightMergePatch } from "../flightMerge";

/**
 * Dedicated regression guard for companion merge semantics (task 9 of the
 * companion-entity plan). Companions are now also materialised as
 * `FlightCompanion` join rows written by the routes layer, so the merge
 * rule here can no longer be left to drift implicitly alongside `tags` /
 * `coPassengers` — see the comment on the `companions` handling in
 * flightMerge.ts. Behaviour must NOT change as a side effect of the
 * storage change.
 */

const validIncomingBase = {
  departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
  arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
  departureLocal: "2026-05-01T08:00",
  depTimezone: "Europe/Berlin",
  arrivalLocal: "2026-05-01T17:00",
  arrTimezone: "America/New_York",
  flightNumber: "LH123",
};

function makeExistingFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "existing-id",
    userId: "user-1",
    airline: null,
    operatingAirline: null,
    flightNumber: "LH123",
    callsign: null,
    aircraft: null,
    depIcao: null,
    depIata: "FRA",
    depName: null,
    depLat: 50.0379,
    depLon: 8.5622,
    arrIcao: null,
    arrIata: "JFK",
    arrName: null,
    arrLat: 40.6413,
    arrLon: -73.7781,
    departureTime: new Date("2026-05-01T06:00:00.000Z"),
    arrivalTime: new Date("2026-05-01T21:00:00.000Z"),
    status: "scheduled",
    notes: null,
    seatNumber: null,
    seatClass: null,
    boardingGroup: null,
    gate: null,
    terminal: null,
    bookingReference: null,
    ticketNumber: null,
    price: null,
    currency: null,
    taxes: null,
    fees: null,
    category: null,
    tags: [],
    companions: [],
    receiptUrl: null,
    ticketPrice: null,
    createdAt: new Date(),
    actualRoute: null,
    overflownCountries: [],
    routeDistance: null,
    routeSource: null,
    hasLiveTracking: false,
    dataSource: "manual",
    lastModifiedBy: "user",
    enrichmentHistory: null,
    actualDeparture: null,
    actualArrival: null,
    delayMinutes: null,
    co2Kg: null,
    baggageAllowance: null,
    frequentFlyerNumber: null,
    bookingClassLetter: null,
    coPassengers: [],
    parserTemplate: null,
    parserConfidence: null,
    nextApiCheckAt: null,
    tripId: null,
    bookingId: null,
    ...overrides,
  };
}

describe("companion merge semantics", () => {
  it("leaves existing companions alone", () => {
    const existing = makeExistingFlight({ companions: ["Anna"] });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      companions: ["Jonas"],
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch).not.toHaveProperty("companions");
    expect(mergedFields).not.toContain("companions");
  });

  it("fills companions when the target has none", () => {
    const existing = makeExistingFlight({ companions: [] });
    const incoming = createFlightSchema.parse({
      ...validIncomingBase,
      companions: ["Jonas"],
    });

    const { patch, mergedFields } = buildFlightMergePatch(existing, incoming);

    expect(patch.companions).toEqual(["Jonas"]);
    expect(mergedFields).toContain("companions");
  });
});
