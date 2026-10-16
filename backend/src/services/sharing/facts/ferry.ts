import type { FerryJourney, Prisma } from "../../../prisma";
import { jsonForWrite, pickFacts } from "./pick";

/**
 * A ferry crossing's facts (rework 2026-10-16; bus's and rail's rule): operator
 * and vessel, both terminals with address, position, country and zone, the
 * times as stored (real instants, ADR 0002), the frozen sea line, what actually
 * happened, status and delay. Private: fare class, seat, cabin type, booking
 * and ticket references, price and FX snapshot, notes, tags, companions, the
 * vehicle on board (type, registration, size, passengers), the vessel MMSI the
 * live position is bound to, and the roadtrip leg it is linked to (with its
 * routing snapshot) — a roadtrip is not shared.
 */
export const FERRY_FACT_FIELDS = [
  "operator",
  "vesselName",
  "depStationName",
  "depAddress",
  "depLat",
  "depLon",
  "depCountry",
  "depTimezone",
  "arrStationName",
  "arrAddress",
  "arrLat",
  "arrLon",
  "arrCountry",
  "arrTimezone",
  "departureTime",
  "arrivalTime",
  "depPrecision",
  "arrPrecision",
  "distanceKm",
  "distanceSource",
  "geometry",
  "geometrySource",
  "actualDepartureTime",
  "actualArrivalTime",
  "status",
  "delayMinutes",
] as const satisfies readonly (keyof FerryJourney)[];

export type FerryFactField = (typeof FERRY_FACT_FIELDS)[number];

export function ferryFacts(row: Pick<FerryJourney, FerryFactField>) {
  const facts = pickFacts(row, FERRY_FACT_FIELDS);
  return {
    ...facts,
    geometry: jsonForWrite(facts.geometry),
  } satisfies Partial<Prisma.FerryJourneyUncheckedCreateInput>;
}
