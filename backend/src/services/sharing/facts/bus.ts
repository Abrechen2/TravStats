import type { BusJourney, Prisma } from "../../../prisma";
import { jsonForWrite, pickFacts } from "./pick";

/**
 * A bus ride's facts (forgejo#288 sweep; rail's rule): operator, line and kind
 * of service, both terminals with address, position, country and zone, the
 * times as stored (real instants, ADR 0002), the frozen road line, what
 * actually happened, status and delay. Private: fare class, seat, booking
 * reference, price and FX snapshot, notes, tags, companions.
 */
export const BUS_FACT_FIELDS = [
  "operator",
  "lineName",
  "rideKind",
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
] as const satisfies readonly (keyof BusJourney)[];

export type BusFactField = (typeof BUS_FACT_FIELDS)[number];

export function busFacts(row: Pick<BusJourney, BusFactField>) {
  const facts = pickFacts(row, BUS_FACT_FIELDS);
  return {
    ...facts,
    geometry: jsonForWrite(facts.geometry),
  } satisfies Partial<Prisma.BusJourneyUncheckedCreateInput>;
}
