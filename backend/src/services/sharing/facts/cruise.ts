import type { Cruise, CruiseLeg, CruiseStop, Prisma } from "../../../prisma";
import { pickFacts } from "./pick";

/**
 * A cruise's facts: ship, line, ports, route name, dates with their zones and
 * status. Private: cabin number and type, deck, booking reference, price and
 * FX snapshot, notes, tags, companions, the map colour.
 */
export const CRUISE_FACT_FIELDS = [
  "shipId",
  "shipNameOverride",
  "cruiseLine",
  "departurePortId",
  "arrivalPortId",
  "routeName",
  "startDate",
  "endDate",
  "startDay",
  "endDay",
  "startZone",
  "endZone",
  "status",
] as const satisfies readonly (keyof Cruise)[];

export type CruiseFactField = (typeof CRUISE_FACT_FIELDS)[number];

export function cruiseFacts(row: Pick<Cruise, CruiseFactField>) {
  return pickFacts(row, CRUISE_FACT_FIELDS) satisfies Partial<Prisma.CruiseUncheckedCreateInput>;
}

/** Every port call is a fact; the excursion note is the member's own. */
export const CRUISE_STOP_FACT_FIELDS = [
  "portId",
  "dayNumber",
  "date",
  "isAtSea",
  "arrivalTime",
  "departureTime",
  "arrivalUtc",
  "departureUtc",
  "stopZone",
  "stopDate",
  "timePrecision",
  "unresolvedPortName",
] as const satisfies readonly (keyof CruiseStop)[];

export type CruiseStopFactField = (typeof CRUISE_STOP_FACT_FIELDS)[number];

export function cruiseStopFacts(row: Pick<CruiseStop, CruiseStopFactField>) {
  return pickFacts(row, CRUISE_STOP_FACT_FIELDS) satisfies Partial<
    Prisma.CruiseStopUncheckedCreateInput
  >;
}

/**
 * The computed sea distance per leg. One ship, one route: copying it lets the
 * recipient's cruise statistics count the voyage without routing it again.
 */
export const CRUISE_LEG_FACT_FIELDS = [
  "ordinal",
  "fromPortId",
  "toPortId",
  "distanceKm",
  "method",
  "routerVersion",
  "dataVersion",
  "confidence",
  "computedAt",
] as const satisfies readonly (keyof CruiseLeg)[];

export type CruiseLegFactField = (typeof CRUISE_LEG_FACT_FIELDS)[number];

export function cruiseLegFacts(row: Pick<CruiseLeg, CruiseLegFactField>) {
  return pickFacts(row, CRUISE_LEG_FACT_FIELDS) satisfies Partial<
    Prisma.CruiseLegUncheckedCreateInput
  >;
}
