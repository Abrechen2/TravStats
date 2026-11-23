import { z } from "zod";
import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { routeCrossingIfStraight, syncCopiesLegs, syncFerryLeg } from "./ferryRouting";

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
  waypoints: z.array(pointSchema).min(3).max(MAX_MANUAL_POINTS),
});

/** A client that names the version it read is refused when the row moved on since. */
function assertBaseVersion(current: Date, base: string | null): void {
  if (base !== null && new Date(base).getTime() !== current.getTime())
    throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
}

const invalid = (message: string) => new AppError(message, 400, "FERRY_ROUTE_INVALID");

/**
 * Set a crossing's route by hand (forgejo#431): the line the user drew, its
 * two ends snapped onto the terminals, stored as `geometrySource = "manual"`.
 * The length follows the line unless the user typed a distance. A re-route
 * only touches a straight crossing, so it never overwrites this.
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
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
}

/**
 * Drop the hand-drawn line: the crossing is a chord again and the router gets
 * another go (best effort, as after any save). A crossing that never had a
 * manual line is left alone.
 */
export async function clearFerryManualRoute(
  userId: string,
  id: string,
  baseVersion: string | null = null
) {
  const existing = await prisma.ferryJourney.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Ferry ride not found", 404);
  assertBaseVersion(existing.updatedAt, baseVersion);
  if (existing.geometrySource !== "manual")
    return { outcome: "unchanged" as const, ride: existing };
  const chord =
    Math.round(
      haversineKm(
        { lat: existing.depLat, lon: existing.depLon },
        { lat: existing.arrLat, lon: existing.arrLon }
      ) * 10
    ) / 10;
  await prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "ferry", id);
      const saved = await tx.ferryJourney.updateMany({
        where: { id, userId, updatedAt: existing.updatedAt, geometrySource: "manual" },
        data: {
          geometry: Prisma.DbNull,
          geometrySource: "straight",
          // A typed distance stays; the line's own length goes with the line.
          ...(existing.distanceSource === "sea_route" && {
            distanceKm: chord,
            distanceSource: "great_circle",
          }),
        },
      });
      if (saved.count !== 1)
        throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
      await syncFerryLeg(
        tx,
        { ...existing, geometry: null, geometrySource: "straight" },
        { onMismatch: "keep", replaceUserLine: "drawn" }
      );
      await propagateWrite(tx, userId, "ferry", id, before);
      if (existing.shareKey) await syncCopiesLegs(tx, existing.shareKey, id);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  const seaRoute = await routeCrossingIfStraight(userId, id, "ferry_manual_route.clear");
  return {
    outcome: seaRoute === "routed" ? ("routed" as const) : ("straight" as const),
    ride: await prisma.ferryJourney.findUniqueOrThrow({ where: { id } }),
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
  if (!ferry || waypoints.length < 3) return;
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
  )
    return;
  const before = await shareSnapshot(tx, "ferry", ferry.id);
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
