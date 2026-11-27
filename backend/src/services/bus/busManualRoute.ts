import { z } from "zod";
import { prisma } from "../../db";
import { Prisma, type BusJourney } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { routeStraightRide } from "./busRouteAgain";

/**
 * A hand-drawn line for a coach ride (forgejo#408/GitHub #409), the ferry's
 * `route-override` without the pair scope: the router knows today's roads, not
 * those of the ride's date, and a wrong line used to be removable only by
 * deleting the ride.
 *
 * `geometrySource = manual` is never replaced by a re-route (single, on-save or
 * the bulk pass). A manual row with no geometry is the "keep straight" choice:
 * the chord is the user's answer, so the router does not refill it.
 */

/** A line's two ends may sit this far from the terminals (coordinate rounding only). */
const ANCHOR_TOLERANCE_KM = 1;
/** Storage guard, not a UX limit. */
export const MAX_BUS_MANUAL_POINTS = 64;
/** Same sanity ceiling as the ferry's: a line far longer than the ride can be is a slip. */
const MAX_DETOUR_FACTOR = 20;
const MIN_ALLOWED_KM = 25;

const pointSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const busManualRouteSchema = z.union([
  z.object({
    /** The ride's `updatedAt` the editor opened; a newer row refuses the save. */
    baseVersion: z.string().optional(),
    /** At least one via point: two points are the chord, which `keepStraight` is. */
    waypoints: z.array(pointSchema).min(3).max(MAX_BUS_MANUAL_POINTS),
  }),
  z.object({ baseVersion: z.string().optional(), keepStraight: z.literal(true) }),
]);

const invalid = (message: string) => new AppError(message, 400, "BUS_ROUTE_INVALID");

const round1 = (km: number): number => Math.round(km * 10) / 10;

function assertBaseVersion(current: Date, base: string | null): void {
  if (base !== null && new Date(base).getTime() !== current.getTime())
    throw new AppError("Bus ride changed elsewhere", 409, "VERSION_CONFLICT");
}

function describeInvalid(body: unknown): string {
  const points = (body as { waypoints?: unknown } | null)?.waypoints;
  if (!Array.isArray(points)) return "Send waypoints or keepStraight";
  if (points.length < 3) return "A hand-drawn route needs at least one point between the terminals";
  if (points.length > MAX_BUS_MANUAL_POINTS)
    return `A hand-drawn route may have at most ${MAX_BUS_MANUAL_POINTS} points`;
  return "The route has a point outside the valid coordinate range";
}

/** Draw a ride's line by hand, or pin it to the chord. Returns the updated row. */
export async function setBusManualRoute(
  userId: string,
  id: string,
  body: unknown,
  baseVersion: string | null = null
): Promise<BusJourney> {
  const parsed = busManualRouteSchema.safeParse(body);
  if (!parsed.success) throw invalid(describeInvalid(body));
  const existing = await prisma.busJourney.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Bus ride not found", 404);
  assertBaseVersion(existing.updatedAt, baseVersion);
  const dep = { lat: existing.depLat, lon: existing.depLon };
  const arr = { lat: existing.arrLat, lon: existing.arrLon };

  let geometry: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
  let km: number;
  let distanceSource: "route" | "great_circle";
  if ("keepStraight" in parsed.data) {
    km = haversineKm(dep, arr);
    distanceSource = "great_circle";
  } else {
    const given = parsed.data.waypoints;
    const first = given[0];
    const last = given[given.length - 1];
    if (
      haversineKm(dep, { lat: first[1], lon: first[0] }) > ANCHOR_TOLERANCE_KM ||
      haversineKm(arr, { lat: last[1], lon: last[0] }) > ANCHOR_TOLERANCE_KM
    )
      throw new AppError(
        "The route must start at the departure stop and end at the arrival stop",
        400,
        "BUS_ROUTE_NOT_ANCHORED"
      );
    const line: Array<[number, number]> = [
      [dep.lon, dep.lat],
      ...given.slice(1, -1),
      [arr.lon, arr.lat],
    ];
    km = polylineLengthKm(line.map(([lon, lat]) => ({ lat, lon })));
    if (
      !Number.isFinite(km) ||
      km > Math.max(haversineKm(dep, arr) * MAX_DETOUR_FACTOR, MIN_ALLOWED_KM)
    )
      throw invalid("The route is far longer than the ride can be");
    geometry = line as unknown as Prisma.InputJsonValue;
    distanceSource = "route";
  }

  return prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "bus", id);
      const saved = await tx.busJourney.updateMany({
        where: { id, userId, updatedAt: existing.updatedAt },
        data: {
          geometry,
          geometrySource: "manual",
          // A typed ticket distance stays; otherwise the figure follows the line.
          ...(existing.distanceSource !== "user" && { distanceKm: round1(km), distanceSource }),
        },
      });
      if (saved.count !== 1)
        throw new AppError("Bus ride changed elsewhere", 409, "VERSION_CONFLICT");
      await propagateWrite(tx, userId, "bus", id, before);
      return tx.busJourney.findUniqueOrThrow({ where: { id } });
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

export type ClearOutcome = "routed" | "straight" | "unchanged";

/** Drop the manual line: back to a chord, then the router gets one try. */
export async function clearBusManualRoute(
  userId: string,
  id: string,
  baseVersion: string | null = null
): Promise<{ outcome: ClearOutcome; ride: BusJourney }> {
  const existing = await prisma.busJourney.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Bus ride not found", 404);
  assertBaseVersion(existing.updatedAt, baseVersion);
  if (existing.geometrySource !== "manual") return { outcome: "unchanged", ride: existing };
  await prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "bus", id);
      const saved = await tx.busJourney.updateMany({
        where: { id, userId, geometrySource: "manual", updatedAt: existing.updatedAt },
        data: {
          geometry: Prisma.DbNull,
          geometrySource: "straight",
          ...(existing.distanceSource !== "user" && {
            distanceKm: round1(
              haversineKm(
                { lat: existing.depLat, lon: existing.depLon },
                { lat: existing.arrLat, lon: existing.arrLon }
              )
            ),
            distanceSource: "great_circle",
          }),
        },
      });
      if (saved.count !== 1)
        throw new AppError("Bus ride changed elsewhere", 409, "VERSION_CONFLICT");
      await propagateWrite(tx, userId, "bus", id, before);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  // A provider that does not deliver leaves the chord, reported as `straight`.
  const report = await routeStraightRide(userId, id);
  const ride = await prisma.busJourney.findUniqueOrThrow({ where: { id } });
  return { outcome: report?.outcome === "routed" ? "routed" : "straight", ride };
}
