import { prisma } from "../../db";
import logger from "../../utils/logger";
import { findRunningJob, startJob, type JobView } from "../jobs/jobRegistry";
import { railRoutingBaseUrl } from "./openRailRouting";
import { routeRailJourneyAgain } from "./railRouteAgain";

/**
 * The one-off repair after tram and U-Bahn rides got their own routing
 * network (tester report 2026-10-25). Until then every ride was routed as a
 * train, so each tram or U-Bahn ride frozen with an `openrailrouting` line is
 * suspect. This pass routes every such ride on the instance again, through the
 * same per-ride path as "route again": a better line replaces it, a line its
 * own network proves wrong gives way to the straight one, and a router that is
 * merely down keeps it.
 *
 * Admin-only and instance-wide, because the defect was the instance's, not a
 * user's choice. Started from Administration -> external services, or with
 * `POST /api/v1/admin/instance-settings/rail-routing/reroute-local-transit`
 * (docs/features/rail-routing.md).
 */

export const LOCAL_TRANSIT_MODES = ["tram", "metro"] as const;

export interface LocalTransitRerouteResult {
  total: number;
  routed: number;
  /** Lines dropped back to straight: their own network knows no such route. */
  straight: number;
  kept: number;
  /** Rides that changed while they were routed, or failed outright. */
  skipped: number;
  /** Set when the pass stopped early because the router stopped answering. */
  stoppedBy: "railRoutingUnavailable" | null;
  remaining: number;
}

async function rerouteAll(
  reportProgress: (done: number, total: number) => void
): Promise<LocalTransitRerouteResult> {
  const rides = await prisma.railJourney.findMany({
    where: { transitMode: { in: [...LOCAL_TRANSIT_MODES] }, geometrySource: "openrailrouting" },
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
  });
  const result: LocalTransitRerouteResult = {
    total: rides.length,
    routed: 0,
    straight: 0,
    kept: 0,
    skipped: 0,
    stoppedBy: null,
    remaining: 0,
  };
  for (const [index, ride] of rides.entries()) {
    reportProgress(index, rides.length);
    try {
      const done = await routeRailJourneyAgain(ride.userId, ride.id);
      const outcome = done?.report.outcome;
      if (outcome === "routed" || outcome === "traced") result.routed += 1;
      else if (outcome === "straight") result.straight += 1;
      else if (outcome === "kept") result.kept += 1;
      else result.skipped += 1;
      // A router that stopped answering would only "keep" every ride after it.
      if (done?.report.fallback === "railRoutingUnavailable") {
        result.stoppedBy = "railRoutingUnavailable";
        result.remaining = rides.length - index - 1;
        break;
      }
    } catch (error) {
      result.skipped += 1;
      logger.warn({ operation: "rail_reroute_local_transit", railJourneyId: ride.id, error });
    }
  }
  reportProgress(rides.length, rides.length);
  logger.info({ operation: "rail_reroute_local_transit", ...result });
  return result;
}

/** Start the pass, or answer the one already running; null without a rail router. */
export async function startLocalTransitReroute(adminId: string): Promise<JobView | null> {
  const running = findRunningJob(["rail.rerouteLocalTransit"]);
  if (running) return running;
  if (!(await railRoutingBaseUrl())) return null;
  return startJob("rail.rerouteLocalTransit", adminId, rerouteAll);
}
