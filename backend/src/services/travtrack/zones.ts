import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { ZoneCircle } from "./classify";

import { onPointsRemoved } from "./deleteRange";
import { takeTravTrackLock } from "./lock";

/**
 * TravTrack's privacy zones (TravTrack plan T2; ported from the archived
 * location history, spec 2026-10-20 §3.6): a circle where the user is never
 * tracked. The phone drops a fix inside one, ingest drops it again, and
 * creating or moving or enlarging a zone deletes the points already stored
 * inside it — their links with them — but only once the user has seen how
 * many and said yes.
 *
 * Every create and update calls `onPointsRemoved` with the new circle,
 * whether or not it deleted a point: a zone over no stored point can still
 * lie under a chord of a shared route (plan T7).
 *
 * Every write takes the lock that ingest takes, so a point cannot slip in
 * between the count and the delete, nor be stored inside a zone that is being
 * written.
 */

/** Zones per account: a home, a workplace, family, a few more. */
export const LOCATION_ZONE_MAX = 20;

export type ZoneInput = { name: string; lat: number; lon: number; radiusM: number };

const circleOf = (z: ZoneInput): ZoneCircle => ({ lat: z.lat, lon: z.lon, radiusM: z.radiusM });

const notFound = (): AppError =>
  new AppError("Privacy zone not found", 404, "LOCATION_ZONE_NOT_FOUND");

const ZONE_SELECT = {
  id: true,
  name: true,
  lat: true,
  lon: true,
  radiusM: true,
  createdAt: true,
  updatedAt: true,
} as const;

const EARTH_RADIUS_M = 6_371_008.8;
const deg = (radians: number) => (radians * 180) / Math.PI;
/** Float headroom: the box may only ever be larger than the circle, never smaller. */
const BOX_MARGIN = 1.001;

/**
 * The SQL condition "this row's position lies inside the circle": a bounding
 * box that spares the trigonometry on most rows, then the haversine distance —
 * the same sphere and formula as `distanceM`. The box is the exact spherical
 * one (Matuschek, "Finding points within a distance of a latitude/longitude"),
 * widened a little: it must never cut off a point the distance would keep.
 */
function insideCircle(z: { lat: number; lon: number; radiusM: number }): Prisma.Sql {
  const angular = z.radiusM / EARTH_RADIUS_M;
  const dLat = deg(angular) * BOX_MARGIN;
  const cosLat = Math.cos((z.lat * Math.PI) / 180);
  // Over a pole every longitude is near; there the box bounds latitude only.
  const nearPole = Math.abs(z.lat) + dLat >= 90 || Math.sin(angular) >= cosLat;
  const dLon = nearPole ? 360 : deg(Math.asin(Math.sin(angular) / cosLat)) * BOX_MARGIN;
  // Across the antimeridian the box would wrap: leave longitude to the distance.
  const lonBox =
    nearPole || z.lon - dLon < -180 || z.lon + dLon > 180
      ? Prisma.empty
      : Prisma.sql`AND lon BETWEEN ${z.lon - dLon}::float8 AND ${z.lon + dLon}::float8`;
  // Every parameter cast: PostgreSQL would read `2 * $1` as an integer.
  return Prisma.sql`lat BETWEEN ${z.lat - dLat}::float8 AND ${z.lat + dLat}::float8 ${lonBox}
    AND 2 * ${EARTH_RADIUS_M}::float8 * asin(least(1, sqrt(
      power(sin(radians(lat - ${z.lat}::float8) / 2), 2)
      + cos(radians(${z.lat}::float8)) * cos(radians(lat))
        * power(sin(radians(lon - ${z.lon}::float8) / 2), 2)
    ))) <= ${z.radiusM}::float8`;
}

async function pointsInside(tx: DbTransaction, userId: string, z: ZoneInput): Promise<number> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM travtrack_points WHERE user_id = ${userId} AND ${insideCircle(z)}`;
  return Number(rows[0]?.n ?? 0);
}

/** Clears the circle; the points' links cascade. */
async function deleteInside(tx: DbTransaction, userId: string, z: ZoneInput): Promise<number> {
  return tx.$executeRaw`DELETE FROM travtrack_points WHERE user_id = ${userId} AND ${insideCircle(z)}`;
}

/**
 * Stops unless the user has agreed to lose the points inside the circle:
 * 409 LOCATION_ZONE_HOLDS_POINTS names the count, and the client asks.
 */
async function clearInside(
  tx: DbTransaction,
  userId: string,
  z: ZoneInput,
  deleteStoredPoints: boolean
): Promise<number> {
  const count = await pointsInside(tx, userId, z);
  if (count === 0) return 0;
  if (!deleteStoredPoints) {
    throw new AppError(
      "Stored positions lie inside this zone",
      409,
      "LOCATION_ZONE_HOLDS_POINTS",
      undefined,
      { pointsInside: count }
    );
  }
  return deleteInside(tx, userId, z);
}

export async function listZones(userId: string) {
  return prisma.travTrackPrivacyZone.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: ZONE_SELECT,
  });
}

export async function createZone(userId: string, input: ZoneInput, deleteStoredPoints: boolean) {
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    if ((await tx.travTrackPrivacyZone.count({ where: { userId } })) >= LOCATION_ZONE_MAX) {
      throw new AppError(
        "This account holds the most privacy zones there may be",
        409,
        "LOCATION_ZONE_LIMIT"
      );
    }
    const deleted = await clearInside(tx, userId, input, deleteStoredPoints);
    const zone = await tx.travTrackPrivacyZone.create({
      data: { userId, ...input },
      select: ZONE_SELECT,
    });
    await onPointsRemoved(tx, userId, { kind: "zone", zone: circleOf(input) });
    return { zone, deleted };
  });
}

/** Moving or resizing a zone: whatever its new circle covers is cleared, after the same question. */
export async function updateZone(
  userId: string,
  id: string,
  patch: Partial<ZoneInput>,
  deleteStoredPoints: boolean
) {
  return prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    const current = await tx.travTrackPrivacyZone.findFirst({ where: { id, userId } });
    if (!current) throw notFound();
    const next: ZoneInput = {
      name: patch.name ?? current.name,
      lat: patch.lat ?? current.lat,
      lon: patch.lon ?? current.lon,
      radiusM: patch.radiusM ?? current.radiusM,
    };
    const deleted = await clearInside(tx, userId, next, deleteStoredPoints);
    const zone = await tx.travTrackPrivacyZone.update({
      where: { id },
      data: next,
      select: ZONE_SELECT,
    });
    await onPointsRemoved(tx, userId, { kind: "zone", zone: circleOf(next) });
    return { zone, deleted };
  });
}

/**
 * Removing a zone records from then on; what it cleared stays gone. Under the
 * lock too: an ingest running now still sees the zone, one after does not.
 */
export async function deleteZone(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    const { count } = await tx.travTrackPrivacyZone.deleteMany({ where: { id, userId } });
    if (count === 0) throw notFound();
  });
}
