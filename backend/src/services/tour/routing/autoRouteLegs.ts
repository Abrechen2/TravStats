import { z } from "zod";

import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { ACCEPTED_LEG_SOURCES } from "../../../schemas/tour";
import type { LegPair } from "../../../shared/tour/legPlan";
import logger from "../../../utils/logger";
import { LEG_MODES, type LegMode } from "../tourDistance";
import { resolveRouteProvider } from "./resolveProvider";
import { routeLegGeometry, type RoutedLeg } from "./routeLeg";
import { isRoutableMode, type RouteProvider, type RoutableMode } from "./types";

/**
 * The write-side check on what a routing outcome may persist
 * (`straight | drawn | routed`). `RoutedLeg.source` is already typed to two
 * of those, so this cannot fail today; it is a backstop against a future
 * change to `routeLegGeometry` writing a value the column is not meant to
 * hold, instead of an `as` cast past the `any`-forbidden rule.
 */
const acceptedLegSource = z.enum(ACCEPTED_LEG_SOURCES);

/** Persist one leg's routing outcome. Shared by the routing endpoints and the automatic pass. */
export async function applyRoutedLeg(legId: string, routed: RoutedLeg): Promise<void> {
  const source = acceptedLegSource.parse(routed.source);
  await prisma.tripRouteLeg.update({
    where: { id: legId },
    data: {
      source,
      confidence: routed.confidence,
      waypoints:
        routed.waypoints === null
          ? Prisma.DbNull
          : (routed.waypoints as unknown as Prisma.InputJsonValue),
      distanceKm: routed.distanceKm,
      drivingMinutes: routed.drivingMinutes,
    },
  });
}

/**
 * How many new legs one save routes before it stops. The first save of a
 * long roadtrip creates one leg per station; routing a hundred of them one
 * after another would hold the request for a minute. What is left stays a
 * straight line, and "route all" in the leg list finishes it.
 */
export const AUTO_ROUTE_MAX_LEGS = 25;

/**
 * The provider adapters carry no timeout of their own, and a save must not
 * hang on a routing service that does not answer. One leg gets this long;
 * the whole pass gets `AUTO_ROUTE_BUDGET_MS`.
 */
const AUTO_ROUTE_LEG_TIMEOUT_MS = 8_000;
const AUTO_ROUTE_BUDGET_MS = 15_000;

function asRoutableMode(mode: string): RoutableMode | null {
  const known = LEG_MODES.find((m): m is LegMode => m === mode);
  return known !== undefined && isRoutableMode(known) ? known : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function routeLegs(
  provider: RouteProvider,
  routeId: string,
  pairs: readonly LegPair[]
): Promise<number> {
  const legs = await prisma.tripRouteLeg.findMany({
    where: {
      routeId,
      source: "straight",
      OR: pairs.map((p) => ({ fromStopId: p.fromStopId, toStopId: p.toStopId })),
    },
    orderBy: { fromStop: { routeOrderIdx: "asc" } },
    include: {
      fromStop: { select: { lat: true, lon: true } },
      toStop: { select: { lat: true, lon: true } },
    },
  });

  const deadline = Date.now() + AUTO_ROUTE_BUDGET_MS;
  let routedCount = 0;
  for (const leg of legs.slice(0, AUTO_ROUTE_MAX_LEGS)) {
    if (Date.now() > deadline) break;
    const mode = asRoutableMode(leg.mode);
    const { fromStop: a, toStop: b } = leg;
    if (mode === null || a.lat === null || a.lon === null || b.lat === null || b.lon === null) {
      continue;
    }
    const routed = await withTimeout(
      routeLegGeometry(provider, {
        from: { lat: a.lat, lon: a.lon },
        to: { lat: b.lat, lon: b.lon },
        mode,
      }),
      AUTO_ROUTE_LEG_TIMEOUT_MS
    );
    // A provider that failed, timed out or answered something untrustworthy
    // leaves the leg exactly as the save wrote it. Writing its straight
    // fallback would only change the timestamp.
    if (routed === null || routed.source !== "routed") continue;
    await applyRoutedLeg(leg.id, routed);
    routedCount++;
  }
  return routedCount;
}

/**
 * Routes the legs a save just CREATED along roads, paths or cycle ways, where
 * the instance has a routing provider. Owner request 2026-09-24: the way
 * between two stations should be a satnav route, not a straight line, on
 * roadtrips and tours alike.
 *
 * Only new legs, and only while they are still `straight`: a leg the user
 * kept, drew by hand or set back to straight on purpose is never touched by a
 * later save. Ferry and rail legs are not routable and stay as they are.
 *
 * Never fails the save. Without a provider it does nothing; with one that
 * errors, it logs and leaves the straight lines, which is what the save
 * already stored. Returns how many legs it routed, so the caller knows
 * whether to read them back.
 */
export async function autoRouteNewLegs(
  userId: string,
  routeId: string,
  pairs: readonly LegPair[]
): Promise<number> {
  if (pairs.length === 0) return 0;
  try {
    const provider = await resolveRouteProvider(userId);
    if (!provider) return 0;
    const routedCount = await routeLegs(provider, routeId, pairs);
    logger.info({
      operation: "tour.route.auto",
      routeId,
      providerId: provider.id,
      newLegs: pairs.length,
      routedCount,
    });
    return routedCount;
  } catch (error) {
    logger.warn(
      {
        operation: "tour.route.auto",
        routeId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Automatic routing failed; the new legs stay straight"
    );
    return 0;
  }
}
