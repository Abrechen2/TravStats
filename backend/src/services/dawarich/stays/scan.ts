import { createHash } from "crypto";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { zoneOf } from "../../../shared/time/zoneOf";
import { createDawarichClient, type DawarichClient } from "../dawarichClient";
import { buildUserDawarichConnection } from "../dawarichResolver";
import { DawarichError } from "../errors";
import { detectStays, meters, RADIUS_METERS } from "./detect";

const DAY = 86_400_000;
export async function ownConnection(userId: string) {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  const connection =
    settings && buildUserDawarichConnection(settings.dawarichBaseUrl, settings.dawarichApiKey);
  if (!connection)
    throw new AppError("Own Dawarich connection required", 409, "DAWARICH_OWN_CONNECTION_REQUIRED");
  return connection;
}

/** A database lease also excludes another server process, not just another click. */
export async function reserveScan(userId: string, now = new Date()): Promise<void> {
  const acquired = await prisma.dawarichStayScan.updateMany({
    where: { userId, enabled: true, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: {
      startedAt: now,
      leaseUntil: new Date(now.getTime() + 60 * 60_000),
      result: "running",
      error: null,
    },
  });
  if (!acquired.count)
    throw new AppError("Scan disabled or already running", 409, "DAWARICH_SCAN_UNAVAILABLE");
}

/** Only findings are written. Confirmation is the sole path to a PlaceVisit. */
export async function scanStays(
  userId: string,
  options: { now?: Date; client?: DawarichClient } = {}
) {
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - 7 * DAY);
  let reservation: { startedAt: Date; leaseUntil: Date } | null = null;
  try {
    const state = await prisma.dawarichStayScan.findUnique({ where: { userId } });
    if (!state?.enabled) throw new AppError("Scan disabled", 409, "DAWARICH_SCAN_UNAVAILABLE");
    if (!state.startedAt || !state.leaseUntil)
      throw new AppError("Scan reservation required", 409, "DAWARICH_SCAN_UNAVAILABLE");
    reservation = { startedAt: state.startedAt, leaseUntil: state.leaseUntil };
    const client = options.client ?? createDawarichClient(await ownConnection(userId));
    const result = await client.getPoints({ startAt: start, endAt: now });
    const points = result.points.filter(
      (p) => p.timestampMs >= start.getTime() && p.timestampMs <= now.getTime()
    );
    const candidates = detectStays(points, result.truncated);
    const places = await prisma.place.findMany({
      where: { userId },
      select: { id: true, name: true, lat: true, lon: true },
    });
    const trips = await prisma.trip.findMany({
      where: { userId },
      select: { id: true, startDate: true, endDate: true },
    });
    let created = 0;
    for (const c of candidates) {
      // A late upstream response belongs to this reservation, never its successor.
      const current = await prisma.dawarichStayScan.findFirst({
        where: { userId, ...reservation, enabled: true },
        select: { userId: true },
      });
      if (!current) break;
      const old = await prisma.dawarichStay.findMany({
        where: { userId, sourceStartAt: { lte: c.endAt }, sourceEndAt: { gte: c.startAt } },
        select: { id: true, sourceLat: true, sourceLon: true },
      });
      if (
        old.some(
          (row) => meters({ lat: row.sourceLat, lon: row.sourceLon }, c) <= RADIUS_METERS * 2
        )
      )
        continue; // includes rejected and accepted findings
      const zone = zoneOf(c);
      if (!zone) throw new AppError("Location timezone unavailable", 422, "TZ_UNRESOLVED");
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(c.startAt);
      const endDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(c.endAt);
      const matchingTrips = trips.filter(
        (t) =>
          t.startDate &&
          t.endDate &&
          t.startDate.toISOString().slice(0, 10) <= endDay &&
          t.endDate.toISOString().slice(0, 10) >= day
      );
      const nearby = places
        .map((p) => ({ ...p, distance: meters(p, c) }))
        .filter((p) => p.distance <= 100)
        .sort((a, b) => a.distance - b.distance);
      const place = nearby[0];
      const matchingVisit = place
        ? await prisma.placeVisit.findFirst({
            where: {
              userId,
              placeId: place.id,
              OR: [
                { visitedAtUtc: { gte: c.startAt, lte: c.endAt } },
                {
                  visitedPrecision: "day",
                  visitedAt: {
                    gte: new Date(day + "T00:00:00Z"),
                    lt: new Date(Date.parse(day + "T00:00:00Z") + DAY),
                  },
                },
              ],
            },
            select: { id: true },
          })
        : null;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            c.pointIds[0],
            c.pointIds.at(-1),
            c.startAt.toISOString(),
            c.endAt.toISOString(),
            c.lat,
            c.lon,
          ])
        )
        .digest("hex");
      const inserted = await prisma.$transaction(async (tx) => {
        // Lock the scan row with the consent/reservation predicate. Revocation
        // or takeover cannot slip between this check and the finding insert.
        const owned = await tx.dawarichStayScan.updateMany({
          where: { userId, ...reservation!, enabled: true },
          data: { result: "running" },
        });
        if (!owned.count) return { count: 0 };
        return tx.dawarichStay.createMany({
          skipDuplicates: true,
          data: [
            {
              userId,
              fingerprint,
              sourceStartAt: c.startAt,
              sourceEndAt: c.endAt,
              sourceLat: c.lat,
              sourceLon: c.lon,
              startAt: c.startAt,
              endAt: c.endAt,
              lat: c.lat,
              lon: c.lon,
              zone,
              pointCount: c.pointCount,
              evidence: {
                source: "dawarich",
                matchingVisitId: matchingVisit?.id ?? null,
                zone,
                pointIds: c.pointIds,
                maxGapMinutes: c.maxGapMinutes,
                uncertainties: [
                  ...c.uncertainties,
                  ...(matchingTrips.length > 1 ? ["tripAmbiguous"] : []),
                  ...(nearby.length > 1 ? ["placeAmbiguous"] : []),
                ],
              },
              placeId: place?.id,
              name: place?.name,
              tripId: matchingTrips.length === 1 ? matchingTrips[0].id : null,
            },
          ],
        });
      });
      created += inserted.count;
    }
    const dataThrough = points.length
      ? new Date(Math.max(...points.map((p) => p.timestampMs)))
      : null;
    await prisma.dawarichStayScan.updateMany({
      where: { userId, ...reservation },
      data: {
        finishedAt: new Date(),
        leaseUntil: null,
        result: result.truncated ? "partial" : "succeeded",
        error: null,
        windowStart: start,
        windowEnd: now,
        dataThrough,
        pointCount: points.length,
        createdCount: created,
      },
    });
    return { created, points: points.length, truncated: result.truncated };
  } catch (error) {
    const code =
      error instanceof DawarichError
        ? error.kind
        : error instanceof AppError
          ? (error.code ?? "FAILED")
          : "FAILED";
    if (reservation)
      await prisma.dawarichStayScan.updateMany({
        where: { userId, ...reservation },
        data: { finishedAt: new Date(), leaseUntil: null, result: "failed", error: code },
      });
    throw new AppError("Dawarich stay scan failed", 502, "DAWARICH_STAY_SCAN_FAILED");
  }
}
