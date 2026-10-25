import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { z } from "zod";
import logger from "../../utils/logger";
import { simplifyDegrees } from "../schematicRouter";
import {
  classifyPoint,
  TRIP_RECORDING_TRIP_SELECT,
  tripRecordingBounds,
  type TripRecordingBounds,
} from "../tripRecording/bounds";
import { privacySafeDevices } from "../tripRecording/privacySafe";
import { rawSegments, type RecordingBreak, type StoredPoint } from "../tripRecording/segments";
import { distanceM, type ZoneCircle } from "./classify";
import type { PointsRemovedCause } from "./deleteRange";
import { privacyCirclesFor } from "./privacyCircles";
import { privacyCut, segmentCrossesZone, type LonLat } from "./privacyCut";
import { receivingMembers } from "../sharing/members";

/**
 * A shared trip's route (TravTrack plan T7, review focus 9 and 15): on the
 * owner's request — never before — the trip's TravTrack line becomes a
 * snapshot its recipients may read. Geometry only: no time, no device, no
 * count beyond the vertices drawn.
 *
 * Built from the points inside the trip's days, outside its flights' recorder
 * windows, cut at every deleted span and reported pause, privacy-cut, then
 * simplified to at most `SNAPSHOT_MAX_VERTICES` — and THEN privacy-cut once
 * more on that final geometry with the home circle added, because
 * simplification makes chords the raw points never had.
 *
 * Every point removal re-filters it in the removal's transaction
 * (`onPointsRemoved`): a deleted span over the trip rebuilds it from what is
 * left, a new or grown zone over it rebuilds it with that zone. A snapshot
 * with nothing left, or one whose rebuild fails, is removed — a recipient
 * never reads a route through a zone that exists or over a span that was
 * deleted.
 */

export const SNAPSHOT_MAX_VERTICES = 2000;
/** Nothing within this distance of the owner's home is in a shared route. */
export const SNAPSHOT_HOME_M = 1000;
/** A trip holds at most this many points in a snapshot's read; beyond it the route is the first part. */
const SNAPSHOT_POINT_CAP = 200_000;
const START_TOLERANCE_DEG = 0.0001;

type Db = DbTransaction;

export type ShareGeometry = LonLat[][];

const vertexCount = (lines: readonly LonLat[][]) => lines.reduce((n, l) => n + l.length, 0);

/** Each line simplified on its own, the tolerance doubled until the whole fits the cap. */
export function simplifyWithin(lines: readonly LonLat[][], cap: number): ShareGeometry {
  let tolerance = START_TOLERANCE_DEG;
  let out = lines.map((l) => simplifyDegrees(l, tolerance) as LonLat[]);
  for (let attempt = 0; vertexCount(out) > cap && attempt < 30; attempt++) {
    tolerance *= 2;
    out = lines.map((l) => simplifyDegrees(l, tolerance) as LonLat[]);
  }
  if (vertexCount(out) <= cap) return out;
  // More lines than the cap holds even at two vertices each: the longest stay.
  const ranked = [...out].sort((a, b) => b.length - a.length);
  const kept: LonLat[][] = [];
  let n = 0;
  for (const line of ranked) {
    if (n + line.length > cap) continue;
    kept.push(line);
    n += line.length;
  }
  return kept;
}

/**
 * Home as far as the circle needs it: a position. Read leniently on purpose —
 * a stored home missing a field the settings form asks for (its zone) must
 * still keep the route away from it, never let it through.
 */
const homePosition = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});

async function homeCircle(db: Db, userId: string): Promise<ZoneCircle | null> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { homePlace: true },
  });
  const home = homePosition.safeParse(settings?.homePlace);
  return home.success ? { lat: home.data.lat, lon: home.data.lon, radiusM: SNAPSHOT_HOME_M } : null;
}

async function boundsOf(db: Db, userId: string, tripId: string) {
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId },
    select: TRIP_RECORDING_TRIP_SELECT,
  });
  if (!trip) return null;
  return tripRecordingBounds(userId, trip);
}

/**
 * The route as it may be shared, or an empty list when nothing of the trip may
 * be shown. Read through `db`, so inside a removal's transaction the deleted
 * points are already gone and a new zone already in force.
 */
export async function buildShareGeometry(
  db: Db,
  userId: string,
  bounds: TripRecordingBounds
): Promise<ShareGeometry> {
  const window = { gte: new Date(bounds.fromMs), lt: new Date(bounds.untilMs) };
  const overlapping = { userId, fromAt: { lt: window.lt }, toAt: { gt: window.gte } };
  const [rows, deleted, gaps, circles, home] = await Promise.all([
    db.travTrackPoint.findMany({
      where: { userId, t: window },
      orderBy: [{ t: "asc" }, { seq: "asc" }],
      take: SNAPSHOT_POINT_CAP,
      select: { t: true, lat: true, lon: true, accuracyM: true, deviceId: true },
    }),
    db.travTrackDeletedRange.findMany({ where: overlapping, select: { fromAt: true, toAt: true } }),
    db.travTrackGap.findMany({
      where: overlapping,
      select: { fromAt: true, toAt: true, deviceId: true },
    }),
    privacyCirclesFor(userId, bounds.fromMs, db),
    homeCircle(db, userId),
  ]);
  const deletedBreaks = deleted.map((d): RecordingBreak => [d.fromAt.getTime(), d.toAt.getTime()]);
  const byDevice = new Map<string | null, StoredPoint[]>();
  for (const row of rows) {
    // A flight's hours belong to the flight; they stay a break in the trip's line.
    if (classifyPoint(row.t.getTime(), bounds) !== "accepted") continue;
    const list = byDevice.get(row.deviceId) ?? [];
    list.push([row.t.getTime(), row.lat, row.lon, row.accuracyM]);
    byDevice.set(row.deviceId, list);
  }
  const allCircles = home ? [...circles, home] : circles;
  const devices = [...byDevice.entries()].map(([deviceId, points]) => ({
    deviceId,
    points,
    breaks: [
      ...deletedBreaks,
      ...bounds.flightWindows,
      ...gaps
        .filter((g) => g.deviceId === deviceId)
        .map((g): RecordingBreak => [g.fromAt.getTime(), g.toAt.getTime()]),
    ],
  }));
  const lines = rawSegments(privacySafeDevices(devices, allCircles)).map((s) =>
    s.map((p): LonLat => [p[2], p[1]])
  );
  // The check that counts: on the final, simplified geometry.
  return privacyCut(simplifyWithin(lines, SNAPSHOT_MAX_VERTICES), allCircles);
}

/** Builds or rebuilds the snapshot; the version rises on every rebuild. Null when nothing is left. */
async function writeSnapshot(db: Db, userId: string, tripId: string) {
  const bounds = await boundsOf(db, userId, tripId);
  const geometry = bounds ? await buildShareGeometry(db, userId, bounds) : [];
  if (geometry.length === 0) {
    await db.travTrackShareSnapshot.deleteMany({ where: { tripId, userId } });
    return null;
  }
  const pointCount = vertexCount(geometry);
  const json = geometry as unknown as object;
  return db.travTrackShareSnapshot.upsert({
    where: { tripId },
    create: { userId, tripId, geometry: json, pointCount },
    update: { geometry: json, pointCount, version: { increment: 1 } },
    select: { version: true, geometry: true, pointCount: true, createdAt: true },
  });
}

/** `PUT /trips/:id/share-snapshot`: the owner shares (or refreshes) the route. */
export async function shareTripRoute(userId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  const snapshot = await prisma.$transaction((tx) => writeSnapshot(tx, userId, tripId), {
    timeout: 60_000,
  });
  if (!snapshot) {
    throw new AppError(
      "Nothing of this trip's TravTrack line may be shown",
      409,
      "TRAVTRACK_ROUTE_EMPTY"
    );
  }
  return snapshot;
}

/** `DELETE /trips/:id/share-snapshot`: revoked for every recipient at once. */
export async function revokeTripRoute(userId: string, tripId: string): Promise<boolean> {
  const { count } = await prisma.travTrackShareSnapshot.deleteMany({ where: { tripId, userId } });
  return count > 0;
}

/** The owner's own view of what is shared, or null. */
export async function tripRouteSnapshot(userId: string, tripId: string) {
  return prisma.travTrackShareSnapshot.findFirst({
    where: { tripId, userId },
    select: { version: true, geometry: true, pointCount: true, createdAt: true },
  });
}

const touches = (geometry: unknown, zone: ZoneCircle): boolean => {
  if (!Array.isArray(geometry)) return true; // unreadable: rebuild rather than trust it
  return (geometry as LonLat[][]).some(
    (line) =>
      Array.isArray(line) &&
      line.some(
        (p, k) =>
          distanceM({ lon: p[0], lat: p[1] }, zone) <= zone.radiusM ||
          (k > 0 && segmentCrossesZone(line[k - 1], p, zone))
      )
  );
};

/**
 * The `onPointsRemoved` handler (registered in `deleteRange.ts`): every
 * snapshot the removal concerns is rebuilt in the removal's transaction, and
 * removed when nothing is left or the rebuild fails.
 */
export async function refilterShareSnapshots(
  tx: Db,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  const snapshots = await tx.travTrackShareSnapshot.findMany({
    where: { userId },
    select: { tripId: true, geometry: true },
  });
  for (const snapshot of snapshots) {
    let concerned: boolean;
    if (cause.kind === "zone") {
      concerned = touches(snapshot.geometry, cause.zone);
    } else {
      const bounds = await boundsOf(tx, userId, snapshot.tripId);
      concerned =
        !bounds || (bounds.fromMs < cause.to.getTime() && bounds.untilMs > cause.from.getTime());
    }
    if (!concerned) continue;
    try {
      await writeSnapshot(tx, userId, snapshot.tripId);
    } catch (error) {
      // Fail closed: a route that could not be re-filtered is not shared.
      logger.warn({
        operation: "travtrack.share_snapshot.refilter_failed",
        tripId: snapshot.tripId,
        cause: cause.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      await tx.travTrackShareSnapshot.deleteMany({ where: { tripId: snapshot.tripId } });
    }
  }
}

/**
 * `GET /trips/:id/shared-route` for a recipient: `tripId` is the READER's own
 * copy. The routes are those of the other members of its share group who
 * shared one and whose changes reach the reader (an accepted consent, an
 * active account — `receivingMembers`, the rule every shared write follows).
 * Geometry and version only; never a point, a time or a device.
 */
export async function sharedTripRoutes(readerId: string, tripId: string) {
  const own = await prisma.trip.findFirst({
    where: { id: tripId, userId: readerId },
    select: { shareGroupId: true },
  });
  if (!own) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  if (!own.shareGroupId) return [];
  const groupId = own.shareGroupId;
  const snapshots = await prisma.travTrackShareSnapshot.findMany({
    where: { userId: { not: readerId }, trip: { shareGroupId: groupId } },
    select: { userId: true, version: true, geometry: true, trip: { select: { createdAt: true } } },
    orderBy: { trip: { createdAt: "asc" } },
  });
  const routes: Array<{ version: number; geometry: unknown }> = [];
  for (const s of snapshots) {
    const reached = await receivingMembers(prisma, groupId, s.userId);
    if (reached.some((m) => m.userId === readerId)) {
      routes.push({ version: s.version, geometry: s.geometry });
    }
  }
  return routes;
}
