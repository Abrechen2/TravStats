import type { Prisma, RailJourney } from "../../../prisma";
import { jsonForWrite, pickFacts } from "./pick";

/**
 * A rail journey's facts: train, both stations with position, country and
 * zone, the times as stored (real instants, ADR 0002), the frozen line, what
 * actually happened, status and delay, and whether it was a train at all (a
 * U-Bahn or tram ride counts in nobody's rail figures). Private: class, coach, seat, booking
 * reference, price and FX snapshot, notes, tags, companions.
 */
export const RAIL_FACT_FIELDS = [
  "operator",
  "trainCategory",
  "trainNumber",
  "depStationName",
  "depStationCode",
  "depStationId",
  "depLat",
  "depLon",
  "depCountry",
  "depTimezone",
  "arrStationName",
  "arrStationCode",
  "arrStationId",
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
  "lookupProvider",
  "lookupRef",
  "status",
  "delayMinutes",
  "transitMode",
] as const satisfies readonly (keyof RailJourney)[];

export type RailFactField = (typeof RAIL_FACT_FIELDS)[number];

export function railFacts(row: Pick<RailJourney, RailFactField>) {
  const facts = pickFacts(row, RAIL_FACT_FIELDS);
  return {
    ...facts,
    geometry: jsonForWrite(facts.geometry),
  } satisfies Partial<Prisma.RailJourneyUncheckedCreateInput>;
}
