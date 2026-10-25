/**
 * A zone created or grown hides more than the points inside it (Codex review
 * of TravTrack plan L3): a chord that crossed it was counted as ground
 * kilometres, and a dwell beside it may have a cell centre in it. Neither
 * needs a stored point inside the circle, so the removal's days may be none —
 * and the month would stay acknowledged with figures the zone now hides.
 *
 * So every month holding a point that could reach the circle is deleted and
 * owed again, in the zone's own transaction: a stretch joins no two fixes more
 * than `RECORDING_GAP_KM` apart, and a dwell's cell centre lies within about
 * a kilometre of its points, so every point within the radius plus that
 * reach is a candidate — a box around the circle, wide rather than exact.
 */
import { Prisma } from "../../../prisma";
import type { DbTransaction } from "../../../db";
import { RECORDING_GAP_KM } from "../../tripRecording/segments";
import type { ZoneCircle } from "../classify";
import { MONTHS_BIT } from "../dirtyDays";

/** A dwell's points to its cell's centre: the cell's half-diagonal plus the dwell radius. */
const CELL_REACH_KM = 1.1;
const KM_PER_DEG_LAT = 111.0;

export async function monthsOnZoneChanged(
  tx: DbTransaction,
  userId: string,
  zone: ZoneCircle
): Promise<void> {
  const reachKm = zone.radiusM / 1000 + RECORDING_GAP_KM + CELL_REACH_KM;
  const dLat = reachKm / KM_PER_DEG_LAT;
  const cos = Math.cos((zone.lat * Math.PI) / 180);
  const dLon = cos > 0.01 ? reachKm / (KM_PER_DEG_LAT * cos) : 360;
  const lonMin = zone.lon - dLon;
  const lonMax = zone.lon + dLon;
  // Across the antimeridian or near a pole the box is every longitude.
  const lonFilter =
    lonMin < -180 || lonMax > 180
      ? Prisma.empty
      : Prisma.sql`AND lon BETWEEN ${lonMin} AND ${lonMax}`;
  const rows = await tx.$queryRaw<{ month: Date }[]>`
    SELECT DISTINCT date_trunc('month', t)::date AS month FROM travtrack_points
     WHERE user_id = ${userId}
       AND lat BETWEEN ${zone.lat - dLat} AND ${zone.lat + dLat} ${lonFilter}`;
  if (rows.length === 0) return;
  const months = rows.map((r) => r.month);
  await tx.travTrackMonthValue.deleteMany({ where: { userId, month: { in: months } } });
  const keys = months.map((m) => m.toISOString().slice(0, 10));
  await tx.$executeRaw`
    UPDATE travtrack_dirty_days SET done = done & ~${MONTHS_BIT}::int
     WHERE user_id = ${userId}
       AND date_trunc('month', day)::date = ANY(${keys}::date[])`;
}
