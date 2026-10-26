import { prisma, type DbTransaction } from "../../db";
import type { ZoneCircle } from "./classify";

/**
 * The circles a line of this account must not show (TravTrack plan T5): every
 * privacy zone in force, and every former zone's circle whose exclusion still
 * covers the line — one that went after the line began, so the line may hold
 * a moment it protected. A line recorded wholly after a zone went is not cut
 * by it: what the user records there now, they record on purpose.
 */
export type CircleSet = (lineFromMs: number) => ZoneCircle[];

/** Read once, asked per line — for a read that draws many lines (the map). */
/** Read through `db` inside a transaction, so a zone written in it is already in force. */
type CircleReader = Pick<DbTransaction, "travTrackPrivacyZone" | "travTrackZoneTombstone">;

export async function privacyCircleSet(
  userId: string,
  db: CircleReader = prisma
): Promise<CircleSet> {
  const [zones, tombstones] = await Promise.all([
    db.travTrackPrivacyZone.findMany({
      where: { userId },
      select: { lat: true, lon: true, radiusM: true },
    }),
    db.travTrackZoneTombstone.findMany({
      where: { userId },
      select: { lat: true, lon: true, radiusM: true, untilAt: true },
    }),
  ]);
  return (fromMs) => [
    ...zones,
    ...tombstones
      .filter((t) => t.untilAt.getTime() > fromMs)
      .map(({ lat, lon, radiusM }) => ({ lat, lon, radiusM })),
  ];
}

export async function privacyCirclesFor(
  userId: string,
  fromMs: number,
  db: CircleReader = prisma
): Promise<ZoneCircle[]> {
  return (await privacyCircleSet(userId, db))(fromMs);
}
