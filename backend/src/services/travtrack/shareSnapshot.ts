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
 * What the owner shared, as a rebuild the owner did not ask for must respect
 * it: the points received by `createdAt`, the window `[sharedFrom,
 * sharedUntil)` and every home circle in force since. A re-filter or a read
 * may only take away from it, never widen it (security review of T7); only
 * the owner's own build sets it anew.
 */
export type SharedState = {
  createdAt: Date;
  sharedFrom: Date | null;
  sharedUntil: Date | null;
  homeCircles: unknown;
};

const circleList = z.array(
  z.object({
    lat: z.number().finite(),
    lon: z.number().finite(),
    radiusM: z.number().finite().positive(),
  })
);

/** The stored home circles, or null when they cannot be read (then nothing is shared). */
const homesOf = (state: SharedState): ZoneCircle[] | null => {
  const parsed = circleList.safeParse(state.homeCircles);
  return parsed.success ? parsed.data : null;
};

/**
 * The bounds an automatic rebuild or a read may use: the overlap of the
 * window the owner shared with the trip's current days, the current flights
 * kept as breaks. Null when they no longer overlap, or the window is unknown.
 */
export function effectiveBounds(
  current: TripRecordingBounds,
  state: SharedState
): TripRecordingBounds | null {
  if (!state.sharedFrom || !state.sharedUntil) return null;
  const fromMs = Math.max(current.fromMs, state.sharedFrom.getTime());
  const untilMs = Math.min(current.untilMs, state.sharedUntil.getTime());
  return fromMs < untilMs ? { ...current, fromMs, untilMs } : null;
}

const sameCircle = (a: ZoneCircle, b: ZoneCircle) =>
  a.lat === b.lat && a.lon === b.lon && a.radiusM === b.radiusM;

/**
 * The route as it may be shared, or an empty list when nothing of the trip may
 * be shown. Read through `db`, so inside a removal's transaction the deleted
 * points are already gone and a new zone already in force. `recordedBy` and
 * `homes` narrow it to what the owner shared (`SharedState`); the current home
 * is always cut too, and returned so a rebuild can keep it.
 */
export async function buildShareGeometry(
  db: Db,
  userId: string,
  bounds: TripRecordingBounds,
  opts: { recordedBy?: Date | null; homes?: readonly ZoneCircle[] } = {}
): Promise<{ geometry: ShareGeometry; home: ZoneCircle | null }> {
  const recordedBy = opts.recordedBy ?? null;
  const window = { gte: new Date(bounds.fromMs), lt: new Date(bounds.untilMs) };
  const overlapping = { userId, fromAt: { lt: window.lt }, toAt: { gt: window.gte } };
  const [rows, deleted, gaps, circles, home] = await Promise.all([
    db.travTrackPoint.findMany({
      // A rebuild the owner did not ask for takes in nothing received since
      // the owner's last build: it may only take away.
      where: { userId, t: window, ...(recordedBy ? { createdAt: { lte: recordedBy } } : {}) },
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
  const allCircles = [...circles, ...(opts.homes ?? []), ...(home ? [home] : [])];
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
  return { geometry: privacyCut(simplifyWithin(lines, SNAPSHOT_MAX_VERTICES), allCircles), home };
}

/**
 * Builds or rebuilds the snapshot; the version rises on every rebuild. Null
 * when nothing is left. `shared` null is the owner's own build: every point of
 * the trip's current days, the current home, and `createdAt` becomes now. A
 * re-filter passes the stored `SharedState` and so never shares more than the
 * owner did: narrower window, more home circles, no newer point.
 */
async function writeSnapshot(db: Db, userId: string, tripId: string, shared: SharedState | null) {
  const current = await boundsOf(db, userId, tripId);
  const homes = shared ? homesOf(shared) : [];
  const bounds = current && shared ? effectiveBounds(current, shared) : current;
  const built =
    bounds && homes
      ? await buildShareGeometry(db, userId, bounds, {
          recordedBy: shared?.createdAt ?? null,
          homes,
        })
      : null;
  if (!built || !bounds || built.geometry.length === 0) {
    await db.travTrackShareSnapshot.deleteMany({ where: { tripId, userId } });
    return null;
  }
  const { geometry, home } = built;
  const keptHomes = [
    ...(homes ?? []),
    ...(home && !(homes ?? []).some((h) => sameCircle(h, home)) ? [home] : []),
  ];
  const window = { sharedFrom: new Date(bounds.fromMs), sharedUntil: new Date(bounds.untilMs) };
  const pointCount = vertexCount(geometry);
  const json = geometry as unknown as object;
  return db.travTrackShareSnapshot.upsert({
    where: { tripId },
    create: { userId, tripId, geometry: json, pointCount, ...window, homeCircles: keptHomes },
    update: {
      geometry: json,
      pointCount,
      version: { increment: 1 },
      ...window,
      homeCircles: keptHomes,
      ...(shared ? {} : { createdAt: new Date() }),
    },
    select: { version: true, geometry: true, pointCount: true, createdAt: true },
  });
}

const SHARED_STATE_SELECT = {
  createdAt: true,
  sharedFrom: true,
  sharedUntil: true,
  homeCircles: true,
} as const;

/** `PUT /trips/:id/share-snapshot`: the owner shares (or refreshes) the route. */
export async function shareTripRoute(userId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  const snapshot = await prisma.$transaction((tx) => writeSnapshot(tx, userId, tripId, null), {
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
    select: { tripId: true, geometry: true, ...SHARED_STATE_SELECT },
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
    await rebuildOrDrop(tx, userId, snapshot, cause.kind);
  }
}

/** One re-filter: rebuilt from what the owner shared, or removed when that fails. */
async function rebuildOrDrop(
  tx: Db,
  userId: string,
  snapshot: SharedState & { tripId: string },
  cause: string
): Promise<void> {
  try {
    await writeSnapshot(tx, userId, snapshot.tripId, snapshot);
  } catch (error) {
    // Fail closed: a route that could not be re-filtered is not shared.
    logger.warn({
      operation: "travtrack.share_snapshot.refilter_failed",
      tripId: snapshot.tripId,
      cause,
      error: error instanceof Error ? error.message : String(error),
    });
    await tx.travTrackShareSnapshot.deleteMany({ where: { tripId: snapshot.tripId } });
  }
}

/**
 * Re-filters the account's snapshots (one trip's, or all) after something
 * they were built from changed without removing points: the home place
 * (`settings/personal`), a trip's dates (`PATCH /trips/:id`). Each is rebuilt
 * from what the owner shared, under the new settings, or removed.
 */
export async function refreshShareSnapshots(userId: string, tripId?: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const snapshots = await tx.travTrackShareSnapshot.findMany({
        where: { userId, ...(tripId ? { tripId } : {}) },
        select: { tripId: true, ...SHARED_STATE_SELECT },
      });
      for (const snapshot of snapshots) await rebuildOrDrop(tx, userId, snapshot, "settings");
    },
    { timeout: 60_000 }
  );
}

/**
 * `GET /trips/:id/shared-route` for a recipient: `tripId` is the READER's own
 * copy. The routes are those of the other members of its share group who
 * shared one and whose changes reach the reader (an accepted consent, an
 * active account — `receivingMembers`, the rule every shared write follows).
 * Geometry and version only; never a point, a time or a device.
 *
 * Built again at READ time, from what the owner shared (`SharedState`: the
 * points received by then, the window shared, every home since) under the
 * rules in force NOW — the overlap with the trip's current days, its current
 * flights, every zone and former zone, the current home, every deletion — so
 * no change the stored
 * copy missed (a flight added, a home moved, a date changed by any path) ever
 * reaches a recipient. The stored geometry is the owner's view and a cache.
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
    select: { userId: true, tripId: true, version: true, ...SHARED_STATE_SELECT },
    orderBy: { trip: { createdAt: "asc" } },
  });
  const routes: Array<{ version: number; geometry: unknown }> = [];
  for (const s of snapshots) {
    const reached = await receivingMembers(prisma, groupId, s.userId);
    if (!reached.some((m) => m.userId === readerId)) continue;
    const current = await boundsOf(prisma, s.userId, s.tripId);
    const bounds = current ? effectiveBounds(current, s) : null;
    const homes = homesOf(s);
    if (!bounds || !homes) continue;
    const { geometry } = await buildShareGeometry(prisma, s.userId, bounds, {
      recordedBy: s.createdAt,
      homes,
    });
    if (geometry.length > 0) routes.push({ version: s.version, geometry });
  }
  return routes;
}
