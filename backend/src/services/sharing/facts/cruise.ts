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
  return pickFacts(
    row,
    CRUISE_STOP_FACT_FIELDS
  ) satisfies Partial<Prisma.CruiseStopUncheckedCreateInput>;
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
  return pickFacts(
    row,
    CRUISE_LEG_FACT_FIELDS
  ) satisfies Partial<Prisma.CruiseLegUncheckedCreateInput>;
}

/**
 * A hand-drawn sea line between two port calls (`cruise_leg_routes`, 2026-11-24: the owner's
 * Antarctica route arrived on his father's server without its line). A fact like the legs: who
 * drew it does not matter, the voyage does. Keyed by the two ports, never by a local row id, and
 * listed in the order of the legs it belongs to — the same order on every server, since the legs
 * travel too — so two servers holding the same lines compare equal.
 */
export interface CruiseLegRouteFact {
  fromPortId: number;
  toPortId: number;
  /** `[[lon, lat], ...]`, first and last at the leg's ports; the wire carries 64 (`thinWaypoints`). */
  waypoints: unknown;
}

/**
 * The most points a line carries on the wire: the receiver refuses more (`CRUISE_LEG_ROUTE_SHAPE`),
 * and the editor stores no more. Only the wire is thinned (`wire/encode.ts`); a line stays whole on
 * this server and in a copy on it. Rows written before that guard hold up to 123 (measured on the
 * owner's Yangtze cruise, UAT 2026-11-27), and ONE such line made the receiver drop the whole
 * message as malformed — the trip could be neither shared nor linked.
 */
export const MAX_ROUTE_FACT_POINTS = 64;

/**
 * A line of more than `MAX_ROUTE_FACT_POINTS` points, thinned to that many by even spacing; the
 * first and last point stay, so the line still starts and ends at its ports. Deterministic: the
 * same line always thins to the same points.
 */
export function thinWaypoints(waypoints: unknown): unknown {
  if (!Array.isArray(waypoints) || waypoints.length <= MAX_ROUTE_FACT_POINTS) return waypoints;
  const last = waypoints.length - 1;
  return Array.from(
    { length: MAX_ROUTE_FACT_POINTS },
    (_, i) => waypoints[Math.round((i * last) / (MAX_ROUTE_FACT_POINTS - 1))]
  );
}

/** The lines of a cruise as facts; a line whose ends are not catalogue ports is left out. */
export function cruiseLegRouteFacts(
  routes: readonly {
    fromKind: string;
    fromRef: string;
    toKind: string;
    toRef: string;
    waypoints: unknown;
  }[],
  legs: readonly { fromPortId: number; toPortId: number }[]
): CruiseLegRouteFact[] {
  const order = (r: CruiseLegRouteFact): number => {
    const at = legs.findIndex((l) => l.fromPortId === r.fromPortId && l.toPortId === r.toPortId);
    return at < 0 ? legs.length : at;
  };
  return routes
    .flatMap((r) => {
      const fromPortId = Number(r.fromRef);
      const toPortId = Number(r.toRef);
      return r.fromKind === "port" &&
        r.toKind === "port" &&
        Number.isInteger(fromPortId) &&
        Number.isInteger(toPortId)
        ? [{ fromPortId, toPortId, waypoints: r.waypoints }]
        : [];
    })
    .sort((a, b) => order(a) - order(b) || a.fromPortId - b.fromPortId || a.toPortId - b.toPortId);
}

/** A fact back into rows of `cruise_leg_routes` for `cruiseId`. */
export function cruiseLegRouteRows(cruiseId: string, routes: readonly CruiseLegRouteFact[]) {
  return routes.map((r) => ({
    cruiseId,
    fromKind: "port",
    fromRef: String(r.fromPortId),
    toKind: "port",
    toRef: String(r.toPortId),
    waypoints: r.waypoints as Prisma.InputJsonValue,
  }));
}
