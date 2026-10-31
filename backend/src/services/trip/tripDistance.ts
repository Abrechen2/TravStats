import { prisma } from "../../db";
import { countableBusWhere } from "../../shared/busCounting";
import { countableCruiseWhere } from "../../shared/cruiseCounting";
import { countableFerryWhere } from "../../shared/ferryCounting";
import { countableFlightWhere } from "../../shared/flightCounting";
import { countableRailWhere } from "../../shared/railCounting";
import { calculateDistance } from "../../utils/geo";
import { now } from "../../shared/time/clock";
import { roadtripCountsIn } from "../../shared/tour/roadtripListScope";
import { ROADTRIP_LIST_SELECT } from "../roadtrip/roadtripList";
import { spanOf } from "../roadtrip/roadtripSummary";
import { drivenKm } from "../tour/tourDistance";

/**
 * A trip's distance, per mode and in total (companion#85).
 *
 * Every mode counts the legs its domain's shared counting rule counts —
 * completed rides, flown flights, finished cruises — so the figure a trip
 * shows is a subset of what the domain statistics already add up, never a
 * second opinion. Roadtrips count their ROAD legs only (`drivenKm`), and only once started: a ferry
 * or rail leg inside a roadtrip is, once linked, a ferry or rail journey of
 * the same trip and would otherwise be counted twice.
 *
 * Abstention is a result: a mode with no measured leg is null, not 0, and the
 * total is null when every mode is. Each mode is rounded to whole kilometres
 * and the total is the sum of the rounded modes, so the parts on screen add up
 * to the whole.
 */

export const TRIP_DISTANCE_MODES = [
  "flight",
  "rail",
  "bus",
  "ferry",
  "cruise",
  "roadtrip",
] as const;
export type TripDistanceMode = (typeof TRIP_DISTANCE_MODES)[number];

export interface TripDistance {
  totalDistanceKm: number | null;
  distanceByMode: Record<TripDistanceMode, number | null>;
}

/** Sum of the measured values, whole km; null when nothing was measured. */
const measuredSum = (values: ReadonlyArray<number | null | undefined>): number | null => {
  const measured = values.filter((v): v is number => typeof v === "number" && v > 0);
  return measured.length === 0 ? null : Math.round(measured.reduce((s, v) => s + v, 0));
};

/** Pure: assembles the response fields from the per-mode figures. */
export function composeTripDistance(byMode: Record<TripDistanceMode, number | null>): TripDistance {
  const known = Object.values(byMode).filter((v): v is number => v !== null);
  return {
    totalDistanceKm: known.length === 0 ? null : known.reduce((s, v) => s + v, 0),
    distanceByMode: byMode,
  };
}

export async function loadTripDistance(userId: string, tripId: string): Promise<TripDistance> {
  const scope = { userId, tripId };
  const [flights, rail, bus, ferry, cruiseLegs, roadtrips] = await Promise.all([
    prisma.flight.findMany({
      where: { ...scope, ...countableFlightWhere() },
      select: { depLat: true, depLon: true, arrLat: true, arrLon: true },
    }),
    prisma.railJourney.aggregate({
      where: { ...scope, ...countableRailWhere() },
      _sum: { distanceKm: true },
    }),
    prisma.busJourney.aggregate({
      where: { ...scope, ...countableBusWhere() },
      _sum: { distanceKm: true },
    }),
    prisma.ferryJourney.aggregate({
      where: { ...scope, ...countableFerryWhere() },
      _sum: { distanceKm: true },
    }),
    prisma.cruiseLeg.findMany({
      where: { cruise: { ...scope, ...countableCruiseWhere() } },
      select: { distanceKm: true },
    }),
    prisma.tripRoute.findMany({
      where: { ...scope, kind: "roadtrip" },
      select: { legs: ROADTRIP_LIST_SELECT.legs, stops: ROADTRIP_LIST_SELECT.stops },
    }),
  ]);
  return composeTripDistance({
    flight: measuredSum(
      flights.map((f) => calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon))
    ),
    rail: measuredSum([rail._sum.distanceKm]),
    bus: measuredSum([bus._sum.distanceKm]),
    ferry: measuredSum([ferry._sum.distanceKm]),
    cruise: measuredSum(cruiseLegs.map((l) => l.distanceKm)),
    // A roadtrip that has not started is planned and counts nowhere
    // (`roadtripCountsIn`, as the roadtrips tile does).
    roadtrip: measuredSum(
      roadtrips
        .filter((r) => roadtripCountsIn(spanOf(r.stops).startDate, null, now()))
        .map((r) => drivenKm(r.legs))
    ),
  });
}
