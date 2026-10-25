import { prisma } from "../../db";

/**
 * TravTrack's part of the account export (TravTrack plan T7): the owner's
 * whole history as it is stored — every point with the flights and trips it
 * is linked to, the privacy zones and the circles of former ones, the deleted
 * spans and the pauses the phone reported. The owner's own data, so it is
 * not privacy-cut; and it travels whatever the TravTrack switch says, like
 * every other domain of the export.
 *
 * Read in pages of `TRAVTRACK_EXPORT_PAGE` by `seq`, never as one Prisma read:
 * an account can hold a million points. `seq` goes out as a string — it is a
 * BIGSERIAL, and JSON has no 64-bit integer.
 */

export const TRAVTRACK_EXPORT_PAGE = 5000;

const POINT_SELECT = {
  id: true,
  seq: true,
  t: true,
  lat: true,
  lon: true,
  accuracyM: true,
  altitudeM: true,
  speedMps: true,
  course: true,
  motion: true,
  origin: true,
  originRef: true,
  deviceId: true,
  purpose: true,
  createdAt: true,
  links: { select: { entryKind: true, entryId: true } },
} as const;

export async function buildTravTrackDataExport(
  userId: string,
  page: number = TRAVTRACK_EXPORT_PAGE
) {
  const points: Array<Record<string, unknown>> = [];
  let after: bigint | null = null;
  for (;;) {
    const rows: Array<{ seq: bigint; links: Array<{ entryKind: string; entryId: string }> }> =
      await prisma.travTrackPoint.findMany({
        where: { userId, ...(after !== null ? { seq: { gt: after } } : {}) },
        orderBy: { seq: "asc" },
        take: page,
        select: POINT_SELECT,
      });
    for (const { seq, links, ...rest } of rows) {
      points.push({
        ...rest,
        seq: seq.toString(),
        links: links.map((l) => ({ kind: l.entryKind, id: l.entryId })),
      });
    }
    if (rows.length < page) break;
    after = rows[rows.length - 1].seq;
  }
  const where = { userId };
  const [zones, zoneTombstones, deletedRanges, gaps] = await Promise.all([
    prisma.travTrackPrivacyZone.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, lat: true, lon: true, radiusM: true, createdAt: true },
    }),
    prisma.travTrackZoneTombstone.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: { lat: true, lon: true, radiusM: true, untilAt: true, createdAt: true },
    }),
    prisma.travTrackDeletedRange.findMany({
      where,
      orderBy: { fromAt: "asc" },
      select: { fromAt: true, toAt: true, createdAt: true },
    }),
    prisma.travTrackGap.findMany({
      where,
      orderBy: { fromAt: "asc" },
      select: { deviceId: true, fromAt: true, toAt: true, reason: true },
    }),
  ]);
  return { points, zones, zoneTombstones, deletedRanges, gaps };
}

/** Each user record with its `travtrack` section, one user at a time. */
export async function withTravTrackSections<T extends { id: string }>(
  users: readonly T[]
): Promise<Array<T & { travtrack: Awaited<ReturnType<typeof buildTravTrackDataExport>> }>> {
  const out: Array<T & { travtrack: Awaited<ReturnType<typeof buildTravTrackDataExport>> }> = [];
  for (const user of users)
    out.push({ ...user, travtrack: await buildTravTrackDataExport(user.id) });
  return out;
}
