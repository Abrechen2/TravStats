import { z } from "zod";
import { prisma, type DbTransaction } from "../../db";
import { Prisma, type FerryJourney } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { routeCrossingIfStraight, syncCopiesLegs, syncFerryLeg } from "./ferryRouting";
import {
  crossingEnds,
  crossingsOnPair,
  findPairRoute,
  lineForCrossing,
  pairRouteEnds,
} from "./ferryPairRoute";

/** A line's two ends may sit this far from the terminals (coordinate rounding only). */
const ANCHOR_TOLERANCE_KM = 1;
/** Storage guard, not a UX limit: a handful of via points is the normal case. */
export const MAX_MANUAL_POINTS = 64;
/** The same sanity ceiling the router's own result is held to. */
const MAX_DETOUR_FACTOR = 20;
/** A floor for the ceiling: a hop between terminals under 0.5 km apart may still wander a little. */
const MIN_ALLOWED_KM = 25;

const pointSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** At least one via point: two points are the chord, which "clear" already is. */
export const manualRouteSchema = z.object({
  /** The crossing's `updatedAt` the editor opened; a newer row refuses the save. */
  baseVersion: z.string().optional(),
  /** `pair`: every crossing between the same two ports; `journey`: this crossing only. */
  scope: z.enum(["pair", "journey"]).default("pair"),
  waypoints: z.array(pointSchema).min(3).max(MAX_MANUAL_POINTS),
});

/** A client that names the version it read is refused when the row moved on since. */
function assertBaseVersion(current: Date, base: string | null): void {
  if (base !== null && new Date(base).getTime() !== current.getTime())
    throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
}

const invalid = (message: string) => new AppError(message, 400, "FERRY_ROUTE_INVALID");

export type ManualScope = "pair" | "journey";

/** Write a pair line onto one crossing and carry it to its linked leg and its share copies. */
async function applyPairLine(
  tx: DbTransaction,
  ride: FerryJourney,
  line: Array<[number, number]>
): Promise<void> {
  const km = polylineLengthKm(line.map(([lon, lat]) => ({ lat, lon })));
  const before = await shareSnapshot(tx, "ferry", ride.id);
  await tx.ferryJourney.update({
    where: { id: ride.id },
    data: {
      geometry: line as unknown as Prisma.InputJsonValue,
      geometrySource: "manual",
      manualScope: "pair",
      ...(ride.distanceSource !== "user" && {
        distanceKm: Math.round(km * 10) / 10,
        distanceSource: "sea_route",
      }),
    },
  });
  try {
    await syncFerryLeg(
      tx,
      { ...ride, geometry: line, geometrySource: "manual" },
      { onMismatch: "keep", replaceUserLine: "all" }
    );
  } catch (error) {
    // One crossing's stale leg must not undo the line for the others.
    if (!(error instanceof AppError)) throw error;
    logger.warn(
      { operation: "ferry.pair_line.leg", ferryJourneyId: ride.id, code: error.code },
      "a crossing's linked leg was left unchanged"
    );
  }
  await propagateWrite(tx, ride.userId, "ferry", ride.id, before);
  if (ride.shareKey) await syncCopiesLegs(tx, ride.shareKey, ride.id);
}

/**
 * Store `line` (already snapped onto `source`'s terminals) as the user's line
 * for the pair of ports and redraw every other crossing on the pair. A crossing
 * that carries its own line ("only this crossing", or one from before the pair
 * line existed) keeps it.
 */
export async function storePairLine(
  tx: DbTransaction,
  userId: string,
  source: FerryJourney,
  line: Array<[number, number]>
): Promise<number> {
  const found = await findPairRoute(tx, userId, source);
  const ends = found ? pairRouteEnds(found.row) : crossingEnds(source);
  const stored = found?.direction === "reverse" ? [...line].reverse() : line;
  const data = {
    aName: ends.a.name,
    aLat: ends.a.lat,
    aLon: ends.a.lon,
    bName: ends.b.name,
    bLat: ends.b.lat,
    bLon: ends.b.lon,
    waypoints: stored as unknown as Prisma.InputJsonValue,
  };
  if (found) await tx.ferryPairRoute.update({ where: { id: found.row.id }, data });
  else await tx.ferryPairRoute.create({ data: { userId, ...data } });
  let redrawn = 0;
  for (const { ride, direction } of await crossingsOnPair(tx, userId, ends)) {
    if (ride.id === source.id) continue;
    const ownLine = ride.manualScope === "journey" || ride.geometrySource === "manual";
    if (ownLine && ride.manualScope !== "pair") continue;
    const own = lineForCrossing(stored, direction, ride);
    if (!own) continue;
    await applyPairLine(tx, ride, own);
    redrawn += 1;
  }
  return redrawn;
}

/**
 * Set a crossing's route by hand (forgejo#431): the line the user drew, its
 * two ends snapped onto the terminals, stored as `geometrySource = "manual"`.
 * The length follows the line unless the user typed a distance. A re-route
 * only touches a straight crossing, so it never overwrites this.
 *
 * `scope = "pair"` (the default, GitHub #406) makes it the line of every
 * crossing between the same two ports, in both directions; `"journey"` keeps it
 * on this crossing alone.
 */
export async function setFerryManualRoute(
  userId: string,
  id: string,
  body: unknown,
  baseVersion: string | null = null
) {
  const parsed = manualRouteSchema.safeParse(body);
  if (!parsed.success) {
    const tooFew = parsed.error.issues.some((i) => i.code === "too_small");
    throw invalid(
      tooFew
        ? "A hand-drawn route needs at least one point between the terminals"
        : parsed.error.issues.some((i) => i.code === "too_big")
          ? `A hand-drawn route may have at most ${MAX_MANUAL_POINTS} points`
          : "The route has a point outside the valid coordinate range"
    );
  }
  const scope = parsed.data.scope;
  const existing = await prisma.ferryJourney.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Ferry ride not found", 404);
  assertBaseVersion(existing.updatedAt, baseVersion);
  const dep = { lat: existing.depLat, lon: existing.depLon };
  const arr = { lat: existing.arrLat, lon: existing.arrLon };
  const given = parsed.data.waypoints;
  const first = given[0];
  const last = given[given.length - 1];
  if (
    haversineKm(dep, { lat: first[1], lon: first[0] }) > ANCHOR_TOLERANCE_KM ||
    haversineKm(arr, { lat: last[1], lon: last[0] }) > ANCHOR_TOLERANCE_KM
  )
    throw new AppError(
      "The route must start at the departure terminal and end at the arrival terminal",
      400,
      "FERRY_ROUTE_NOT_ANCHORED"
    );
  const line: Array<[number, number]> = [
    [dep.lon, dep.lat],
    ...given.slice(1, -1),
    [arr.lon, arr.lat],
  ];
  const km = polylineLengthKm(line.map(([lon, lat]) => ({ lat, lon })));
  const chord = haversineKm(dep, arr);
  if (!Number.isFinite(km) || km > Math.max(chord * MAX_DETOUR_FACTOR, MIN_ALLOWED_KM))
    throw invalid("The route is far longer than the crossing can be");

  await prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "ferry", id);
      const saved = await tx.ferryJourney.updateMany({
        where: { id, userId, updatedAt: existing.updatedAt },
        data: {
          geometry: line as unknown as Prisma.InputJsonValue,
          geometrySource: "manual",
          manualScope: scope,
          ...(existing.distanceSource !== "user" && {
            distanceKm: Math.round(km * 10) / 10,
            distanceSource: "sea_route",
          }),
        },
      });
      if (saved.count !== 1)
        throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
      await syncFerryLeg(
        tx,
        { ...existing, geometry: line, geometrySource: "manual" },
        { onMismatch: "keep", replaceUserLine: "all" }
      );
      await propagateWrite(tx, userId, "ferry", id, before);
      if (existing.shareKey) await syncCopiesLegs(tx, existing.shareKey, id);
      if (scope === "pair") await storePairLine(tx, userId, existing, line);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
}

/** A crossing back to a chord; `nextScope` "journey" keeps it out of the pair line. */
async function dropManualLine(
  tx: DbTransaction,
  ride: FerryJourney,
  nextScope: ManualScope | null,
  claim: Date | null
): Promise<void> {
  const chord =
    Math.round(
      haversineKm({ lat: ride.depLat, lon: ride.depLon }, { lat: ride.arrLat, lon: ride.arrLon }) *
        10
    ) / 10;
  const before = await shareSnapshot(tx, "ferry", ride.id);
  const saved = await tx.ferryJourney.updateMany({
    where: {
      id: ride.id,
      userId: ride.userId,
      geometrySource: "manual",
      ...(claim && { updatedAt: claim }),
    },
    data: {
      geometry: Prisma.DbNull,
      geometrySource: "straight",
      manualScope: nextScope,
      // A typed distance stays; the line's own length goes with the line.
      ...(ride.distanceSource === "sea_route" && {
        distanceKm: chord,
        distanceSource: "great_circle",
      }),
    },
  });
  if (saved.count !== 1) {
    if (claim) throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
    return;
  }
  await syncFerryLeg(
    tx,
    { ...ride, geometry: null, geometrySource: "straight" },
    { onMismatch: "keep", replaceUserLine: "drawn" }
  );
  await propagateWrite(tx, ride.userId, "ferry", ride.id, before);
  if (ride.shareKey) await syncCopiesLegs(tx, ride.shareKey, ride.id);
}

/**
 * Drop the hand-drawn line: the crossing is a chord again and the router gets
 * another go (best effort, as after any save). A crossing that never had a
 * manual line is left alone.
 *
 * `scope = "all"` (default) removes the pair line too, so every crossing that
 * followed it is a chord again; `"journey"` clears this crossing only, which
 * for one that followed the pair line keeps it out of the pair line from then on.
 */
export async function clearFerryManualRoute(
  userId: string,
  id: string,
  baseVersion: string | null = null,
  scope: "all" | "journey" = "all"
) {
  const existing = await prisma.ferryJourney.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Ferry ride not found", 404);
  assertBaseVersion(existing.updatedAt, baseVersion);
  if (existing.geometrySource !== "manual")
    return { outcome: "unchanged" as const, ride: existing };
  const others: FerryJourney[] = [];
  await prisma.$transaction(
    async (tx) => {
      if (scope === "journey") {
        await dropManualLine(
          tx,
          existing,
          existing.manualScope === "pair" ? "journey" : null,
          existing.updatedAt
        );
        return;
      }
      await dropManualLine(tx, existing, null, existing.updatedAt);
      const found = await findPairRoute(tx, userId, existing);
      if (!found) return;
      await tx.ferryPairRoute.delete({ where: { id: found.row.id } });
      for (const { ride } of await crossingsOnPair(tx, userId, pairRouteEnds(found.row))) {
        if (ride.id === id || ride.manualScope !== "pair" || ride.geometrySource !== "manual")
          continue;
        await dropManualLine(tx, ride, null, null);
        others.push(ride);
      }
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  for (const ride of others)
    await routeCrossingIfStraight(userId, ride.id, "ferry_manual_route.clear_pair");
  const seaRoute = await routeCrossingIfStraight(userId, id, "ferry_manual_route.clear");
  return {
    outcome: seaRoute === "routed" ? ("routed" as const) : ("straight" as const),
    ride: await prisma.ferryJourney.findUniqueOrThrow({ where: { id } }),
  };
}

/** What the editor tells the user before saving: how far a pair line reaches. */
export async function ferryPairInfo(userId: string, id: string) {
  const ride = await prisma.ferryJourney.findFirst({ where: { id, userId } });
  if (!ride) throw new AppError("Ferry ride not found", 404);
  const ends = crossingEnds(ride);
  const crossings = await crossingsOnPair(prisma, userId, ends);
  return {
    count: Math.max(crossings.length, 1),
    from: ends.a.name,
    to: ends.b.name,
    hasPairLine: (await findPairRoute(prisma, userId, ride)) !== null,
  };
}

/**
 * The other direction of the crossing/leg link: the user drew the LEG's line
 * in the tour editor. A linked crossing is the same sea lane, so its stored
 * line follows - otherwise the ferry page and the "Alle" map's ferry layer kept
 * the old line while the tour layer drew the new one. Only a leg whose stops
 * sit on the crossing's terminals qualifies (the same test `syncFerryLeg`
 * applies); a leg linked off the piers keeps its own line and the crossing its.
 */
export async function adoptDrawnLegLineOnFerry(
  tx: DbTransaction,
  userId: string,
  legId: string,
  waypoints: Array<[number, number]>
): Promise<void> {
  const ferry = await tx.ferryJourney.findFirst({ where: { roadtripLegId: legId, userId } });
  if (!ferry) return;
  if (waypoints.length < 3) {
    logger.warn({ operation: "ferry.leg_line_not_adopted", ferryId: ferry.id, reason: "chord" });
    return;
  }
  const near = (a: { lat: number; lon: number }, b: [number, number]) =>
    haversineKm(a, { lat: b[1], lon: b[0] }) <= ANCHOR_TOLERANCE_KM;
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const dep = { lat: ferry.depLat, lon: ferry.depLon };
  const arr = { lat: ferry.arrLat, lon: ferry.arrLon };
  if (!near(dep, first) || !near(arr, last)) return;
  const line: Array<[number, number]> = [
    [dep.lon, dep.lat],
    ...waypoints.slice(1, -1),
    [arr.lon, arr.lat],
  ];
  const km = polylineLengthKm(line.map(([lon, lat]) => ({ lat, lon })));
  if (
    !Number.isFinite(km) ||
    km > Math.max(haversineKm(dep, arr) * MAX_DETOUR_FACTOR, MIN_ALLOWED_KM)
  ) {
    logger.warn({ operation: "ferry.leg_line_not_adopted", ferryId: ferry.id, reason: "too_long" });
    return;
  }
  const before = await shareSnapshot(tx, "ferry", ferry.id);
  // The leg carries the same snapped line as the crossing: one line, two maps.
  await tx.tripRouteLeg.update({
    where: { id: legId },
    data: { waypoints: line as unknown as Prisma.InputJsonValue },
  });
  await tx.ferryJourney.update({
    where: { id: ferry.id },
    data: {
      geometry: line as unknown as Prisma.InputJsonValue,
      geometrySource: "manual",
      ...(ferry.distanceSource !== "user" && {
        distanceKm: Math.round(km * 10) / 10,
        distanceSource: "sea_route",
      }),
    },
  });
  await propagateWrite(tx, userId, "ferry", ferry.id, before);
  if (ferry.shareKey) await syncCopiesLegs(tx, ferry.shareKey, ferry.id);
}

/**
 * The leg's drawn line was cleared in the tour editor: a linked crossing that
 * carries a hand-drawn line on the piers drops it too, so neither map keeps a
 * line the user removed (the router gets another go, as after "clear").
 */
export async function dropManualFerryLineOfLeg(userId: string, legId: string): Promise<void> {
  const ferry = await prisma.ferryJourney.findFirst({
    where: { roadtripLegId: legId, userId, geometrySource: "manual" },
    select: { id: true },
  });
  if (ferry) await clearFerryManualRoute(userId, ferry.id);
}
