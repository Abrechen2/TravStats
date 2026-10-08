import type { RailBookingLeg, RailJourney } from "../../../types/rail";

/** One traced ICE ride, completed — the rail tests' shared starting point. */
export const RAIL_JOURNEY_FIXTURE = {
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
  tightConnection: false,
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
  bookingId: null,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
} satisfies RailJourney;

export function makeRailJourney(overrides: Partial<RailJourney> = {}): RailJourney {
  return { ...RAIL_JOURNEY_FIXTURE, ...overrides };
}

/** A leg of a booking, as the detail read lists it — Frankfurt → Fulda by default. */
export function makeRailBookingLeg(overrides: Partial<RailBookingLeg> = {}): RailBookingLeg {
  return {
    id: "j1",
    depStationName: "Frankfurt",
    arrStationName: "Fulda",
    depStationId: null,
    arrStationId: null,
    departureTime: "2026-09-26T04:15:00.000Z",
    arrivalTime: null,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Berlin",
    trainCategory: "ICE",
    trainNumber: "1",
    status: "completed",
    travelClass: null,
    coach: null,
    seat: null,
    bookingReference: null,
    tightConnection: false,
    ...overrides,
  };
}
