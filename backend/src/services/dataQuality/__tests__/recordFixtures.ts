import type {
  CruiseRecord,
  FlightRecord,
  GroundRecord,
  RecordSnapshot,
  StayRecord,
} from "../recordGather";

/** Hand-written records for the record checks (forgejo#282) — the gather is tested on its own. */

export const CREATED = new Date("2026-01-01T00:00:00Z");

export function flight(over: Partial<FlightRecord> & { id: string }): FlightRecord {
  return {
    label: over.id,
    createdAt: CREATED,
    dataSource: "manual",
    status: "flown",
    tripId: null,
    firstDay: "2026-03-10",
    lastDay: "2026-03-10",
    flightNumber: "LH400",
    airline: "Lufthansa",
    specialType: null,
    isCargo: null,
    dep: { iata: "FRA", icao: "EDDF", name: "Frankfurt" },
    arr: { iata: "JFK", icao: "KJFK", name: "New York JFK" },
    departureAt: new Date("2026-03-10T08:00:00Z"),
    arrivalAt: new Date("2026-03-10T16:00:00Z"),
    ...over,
  };
}

export function ground(over: Partial<GroundRecord> & { id: string }): GroundRecord {
  return {
    label: over.id,
    createdAt: CREATED,
    dataSource: null,
    status: "completed",
    tripId: null,
    firstDay: "2026-03-10",
    lastDay: "2026-03-10",
    service: "ICE599",
    depKey: "#1",
    arrKey: "#2",
    departureAt: new Date("2026-03-10T07:15:00Z"),
    ...over,
  };
}

export function cruise(over: Partial<CruiseRecord> & { id: string }): CruiseRecord {
  return {
    label: over.id,
    createdAt: CREATED,
    dataSource: "manual",
    status: "completed",
    tripId: null,
    firstDay: "2026-05-01",
    lastDay: "2026-05-08",
    shipKey: "#7",
    ...over,
  };
}

export function stay(over: Partial<StayRecord> & { id: string }): StayRecord {
  return {
    label: over.id,
    createdAt: CREATED,
    dataSource: "manual",
    status: "completed",
    tripId: null,
    lodgingId: "l1",
    firstDay: "2026-03-10",
    lastDay: "2026-03-12",
    ...over,
  };
}

export function snapshot(over: Partial<RecordSnapshot> = {}): RecordSnapshot {
  return {
    flights: [],
    railJourneys: [],
    busJourneys: [],
    ferryJourneys: [],
    cruises: [],
    stays: [],
    trips: [],
    knownAirportCodes: new Set(["FRA", "EDDF", "JFK", "KJFK"]),
    airportCatalogueEmpty: false,
    placeVisits: [],
    ...over,
  };
}
