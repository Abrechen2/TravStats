import { propagateWrite, shareSnapshot } from "../sharing/propagate";
import { prisma } from "../../db";
import type { RouteFallbackReason } from "../tour/routing/types";
import { startJob, type JobView } from "../jobs/jobRegistry";
import { describeRoutingAvailability } from "../tour/routing/resolveProvider";
import {
  busGeometryColumns,
  fetchBusLine,
  type BusGeometryReport,
  type BusLine,
} from "./busRouting";

/**
 * Road routing for rides that exist already (spec §5, B3). Every ride logged
 * before the routing shipped is a straight line; "route again" and the bulk
 * pass give them the road without re-saving each one.
 *
 * Only a ride that is still `straight` is routed. A road line is frozen — it
 * is not fetched a second time because someone pressed the button twice — and
 * a hand-drawn (`manual`) line is never replaced. A typed ticket distance
 * stays whichever line exists.
 */

/** How many rides one bulk pass routes; the rest is reported, not silently dropped. */
export const BUS_ROUTE_ALL_MAX_RIDES = 200;

/** Failures that will repeat for every following ride; the pass stops on them. */
const STOP_REASONS: readonly RouteFallbackReason[] = ["rate_limited", "auth", "no_provider"];

export type BusRouteOutcome = BusGeometryReport["outcome"];

const ROUTE_SELECT = {
  id: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  geometrySource: true,
  distanceKm: true,
  distanceSource: true,
} as const;

/**
 * Route one straight ride and freeze the answer. Returns what happened;
 * `unchanged` when the ride already has (or must keep) its line.
 */
export async function routeStraightRide(
  userId: string,
  rideId: string,
  fetchLine: (ends: Parameters<typeof fetchBusLine>[1]) => Promise<BusLine> = (ends) =>
    fetchBusLine(userId, ends)
): Promise<BusGeometryReport | null> {
  const ride = await prisma.busJourney.findFirst({
    where: { id: rideId, userId },
    select: ROUTE_SELECT,
  });
  if (!ride) return null;
  if (ride.geometrySource !== "straight") {
    return { outcome: "unchanged", geometrySource: ride.geometrySource, fallback: null };
  }
  const line = await fetchLine(ride);
  if (line.geometrySource !== "road" || line.routedKm === null) {
    return { outcome: "straight", geometrySource: "straight", fallback: line.fallback };
  }
  // The road line is a shared fact of a ride on a shared trip: the members'
  // copies follow it (design 2026-10-09), so the state before the write is
  // read first, like every other writer of a bus ride does.
  const before = await shareSnapshot(prisma, "bus", ride.id);
  // Written only while the ride is still the one that was read: an edit that
  // moved a terminal or drew a line meanwhile must not be overwritten.
  const written = await prisma.busJourney.updateMany({
    where: {
      id: ride.id,
      userId,
      geometrySource: "straight",
      depLat: ride.depLat,
      depLon: ride.depLon,
      arrLat: ride.arrLat,
      arrLon: ride.arrLon,
    },
    data: {
      ...busGeometryColumns(line),
      ...(ride.distanceSource !== "user" && {
        distanceKm: line.routedKm,
        distanceSource: "route",
      }),
    },
  });
  if (written.count !== 1) {
    return { outcome: "unchanged", geometrySource: "straight", fallback: null };
  }
  await propagateWrite(prisma, userId, "bus", ride.id, before);
  return { outcome: "routed", geometrySource: "road", fallback: null };
}

export interface BusRouteAllResult {
  /** Straight rides found when the pass started. */
  straightRides: number;
  attempted: number;
  routed: number;
  /** Tried and left straight; each carries the provider's reason. */
  straight: number;
  /** Straight rides past the per-pass cap, or not reached after a stop. */
  remaining: number;
  /** Why the pass stopped before the end; null when it ran through. */
  stoppedBy: RouteFallbackReason | null;
  rides: Array<{ id: string; outcome: BusRouteOutcome; fallback: RouteFallbackReason | null }>;
}

/** The running bulk job of this user, if any — a second click joins it. */
const running = new Map<string, JobView>();

async function routeAll(
  userId: string,
  reportProgress: (done: number, total: number) => void
): Promise<BusRouteAllResult> {
  const rides = await prisma.busJourney.findMany({
    where: { userId, geometrySource: "straight" },
    select: { id: true },
    orderBy: [{ departureTime: "desc" }, { id: "asc" }],
  });
  const batch = rides.slice(0, BUS_ROUTE_ALL_MAX_RIDES);
  const result: BusRouteAllResult = {
    straightRides: rides.length,
    attempted: 0,
    routed: 0,
    straight: 0,
    remaining: rides.length - batch.length,
    stoppedBy: null,
    rides: [],
  };
  for (const [index, { id }] of batch.entries()) {
    reportProgress(index, batch.length);
    const report = await routeStraightRide(userId, id);
    if (!report) continue;
    result.attempted += 1;
    if (report.outcome === "routed") result.routed += 1;
    if (report.outcome === "straight") result.straight += 1;
    result.rides.push({ id, outcome: report.outcome, fallback: report.fallback });
    if (report.fallback && STOP_REASONS.includes(report.fallback)) {
      result.stoppedBy = report.fallback;
      result.remaining += batch.length - index - 1;
      break;
    }
  }
  reportProgress(batch.length, batch.length);
  return result;
}

/** Why the bulk pass refuses to start. */
export class BusRoutingUnavailableError extends Error {}

/**
 * Start the bulk pass as a background job (a few hundred provider calls
 * outlast the browser's request timeout). Idempotent: while this user's pass
 * runs, asking again answers that same job.
 */
export async function startRouteAllJob(userId: string): Promise<JobView> {
  const current = running.get(userId);
  if (current) return current;
  const availability = await describeRoutingAvailability(userId);
  if (!availability.configured) throw new BusRoutingUnavailableError();
  const job = startJob("bus.routeStraight", userId, async (reportProgress) => {
    try {
      return await routeAll(userId, reportProgress);
    } finally {
      running.delete(userId);
    }
  });
  running.set(userId, job);
  return job;
}
