import { randomUUID } from "node:crypto";

import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { simplifyDegrees } from "../schematicRouter";
import { classifyPoint, type TripRecordingBounds } from "../tripRecording/bounds";
import { privacySafeDevices } from "../tripRecording/privacySafe";
import { rawSegments, type RecordingBreak, type StoredPoint } from "../tripRecording/segments";
import { receivingMembers } from "../sharing/members";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { takeTravTrackLock } from "./lock";
import { privacyCirclesFor } from "./privacyCircles";
import { privacyCutBy, type LonLat } from "./privacyCut";
import {
  boundsOf,
  homeCircle,
  narrowedRoute,
  PENDING_VERSION,
  SHARED_STATE_SELECT,
  untimed,
  type SharedState,
  vertexCount,
  type TimedGeometry,
  type TimedVertex,
} from "./shareNarrow";

/**
 * A shared trip's route (TravTrack plan T7, review focus 9 and 15): on the
 * owner's request — never before — the trip's TravTrack line becomes a
 * snapshot its recipients may read. Geometry only: no time, no device, no
 * count beyond the vertices drawn.
 *
 * The owner's share is the ONLY thing that selects points (Codex review of
 * the snapshot). It takes the points inside the trip's days, outside its
 * flights' recorder windows, cuts them at every deleted span and reported
 * pause, privacy-cuts them, simplifies them to at most
 * `SNAPSHOT_MAX_VERTICES` — and THEN privacy-cuts that final geometry once
 * more with the home circle added, because simplification makes chords the
 * raw points never had. It stores the result with each vertex's time, the
 * window and the home circle; from then on it is only ever narrowed
 * (`shareNarrow.ts`), and every read narrows it again by the rules in force
 * and by every restriction recorded since. A new share clears those records:
 * it selects from the trip, its flights and the home as they are now.
 */

export const SNAPSHOT_MAX_VERTICES = 2000;
export { SNAPSHOT_HOME_M } from "./shareNarrow";
/** A trip holds at most this many points in the owner's build; beyond it the route is the first part. */
const SNAPSHOT_POINT_CAP = 200_000;
const START_TOLERANCE_DEG = 0.0001;

type Db = DbTransaction;

/** One line simplified on its coordinates; the kept vertices keep their times. */
function simplifyTimed(line: readonly TimedVertex[], tolerance: number): TimedVertex[] {
  const coords = line.map((v): [number, number] => [v[0], v[1]]);
  const at = new Map(coords.map((c, i) => [c, i]));
  // `simplifyDegrees` returns a subset of the very tuples it was given.
  return simplifyDegrees(coords, tolerance).map((c) => line[at.get(c) as number]);
}

/** Each line simplified on its own, the tolerance doubled until the whole fits the cap. */
export function simplifyWithin(lines: readonly TimedVertex[][], cap: number): TimedGeometry {
  let tolerance = START_TOLERANCE_DEG;
  let out = lines.map((l) => simplifyTimed(l, tolerance));
  for (let attempt = 0; vertexCount(out) > cap && attempt < 30; attempt++) {
    tolerance *= 2;
    out = lines.map((l) => simplifyTimed(l, tolerance));
  }
  if (vertexCount(out) <= cap) return out;
  // More lines than the cap holds even at two vertices each: the longest stay.
  const ranked = [...out].sort((a, b) => b.length - a.length);
  const kept: TimedVertex[][] = [];
  let n = 0;
  for (const line of ranked) {
    if (n + line.length > cap) continue;
    kept.push(line);
    n += line.length;
  }
  return kept;
}

/** The owner's build: the trip's route as it may be shared, each vertex with its time. */
async function buildShareGeometry(db: Db, userId: string, bounds: TripRecordingBounds) {
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
  const allCircles = [...circles, ...(home ? [home] : [])];
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
    s.map((p): TimedVertex => [p[2], p[1], p[0]])
  );
  // The check that counts: on the final, simplified geometry.
  const geometry = privacyCutBy(
    simplifyWithin(lines, SNAPSHOT_MAX_VERTICES),
    allCircles,
    (v): LonLat => [v[0], v[1]]
  );
  return { geometry, home };
}

const OWNER_SELECT = {
  version: true,
  geometry: true,
  createdAt: true,
  tripId: true,
  ...SHARED_STATE_SELECT,
} as const;

/** What the owner sees of a stored route: as a recipient reads it now. */
async function ownerView(
  db: Db,
  userId: string,
  row: { version: number; geometry: unknown; createdAt: Date; tripId: string } & SharedState
) {
  const geometry = untimed(await narrowedRoute(db, userId, row));
  return {
    version: row.version,
    geometry,
    pointCount: vertexCount(geometry),
    createdAt: row.createdAt,
  };
}

/** One recorded restriction as the build found it: its row, and when it was last recorded. */
type Recorded = { id: string; recordedSeq: bigint };

/**
 * What is recorded against the route now: only these may the build clear —
 * and each only while it is still recorded as it was. A repeat of a recorded
 * restriction lands on the same row (one row per distinct restriction) and
 * draws a new `recordedSeq`, so a row repeated after this read is told apart
 * from the one captured here (Codex review, fourth round).
 */
async function recordedRows(db: Db, snapshotId: string | undefined) {
  const none: Recorded[] = [];
  if (!snapshotId) return { spans: none, flights: none, homes: none };
  const where = { snapshotId };
  const select = { id: true, recordedSeq: true } as const;
  const [spans, flights, homes] = await Promise.all([
    db.travTrackSharePastSpan.findMany({ where, select }),
    db.travTrackSharePastFlight.findMany({ where, select }),
    db.travTrackSharePastHome.findMany({ where, select }),
  ]);
  return { spans, flights, homes };
}

/** The filter for exactly the captured rows, each still at its captured number. */
function stillAsCaptured(snapshotId: string, rows: readonly Recorded[]) {
  return { snapshotId, OR: rows.map((r) => ({ id: r.id, recordedSeq: r.recordedSeq })) };
}

/** Clears what the build captured; a row recorded again since keeps narrowing the new share. */
async function clearCaptured(
  db: Db,
  snapshotId: string,
  cleared: Awaited<ReturnType<typeof recordedRows>>
) {
  if (cleared.spans.length > 0) {
    await db.travTrackSharePastSpan.deleteMany({
      where: stillAsCaptured(snapshotId, cleared.spans),
    });
  }
  if (cleared.flights.length > 0) {
    await db.travTrackSharePastFlight.deleteMany({
      where: stillAsCaptured(snapshotId, cleared.flights),
    });
  }
  if (cleared.homes.length > 0) {
    await db.travTrackSharePastHome.deleteMany({
      where: stillAsCaptured(snapshotId, cleared.homes),
    });
  }
}

/** The pending row this build relied on was removed before it took the lock. */
class PendingRowGone extends Error {}

/** The row this build read was removed while it ran: the share was revoked. */
class RowRevoked extends Error {}

/** The row this build read moved on while it ran (an automatic narrowing): build again. */
class RowMoved extends Error {}

/** How often a share builds again when its row was removed before, or moved during, the build. */
const MAX_BUILD_ATTEMPTS = 3;

/**
 * The build's one write of a route: an update of exactly the row it read, at
 * the version (and pending token) it read — never an upsert, so a row revoked
 * meanwhile stays revoked (invariant 15, Codex review P1).
 */
async function storeBuilt(
  tx: Db,
  held: { id: string; version: number; buildToken: string | null },
  fields: Record<string, unknown>
) {
  const { count } = await tx.travTrackShareSnapshot.updateMany({
    where: { id: held.id, version: held.version, buildToken: held.buildToken },
    data: { ...fields, version: { increment: 1 }, createdAt: new Date() },
  });
  if (count > 0) return;
  const still = await tx.travTrackShareSnapshot.findUnique({
    where: { id: held.id },
    select: { id: true },
  });
  throw still ? new RowMoved() : new RowRevoked();
}

/** The owner's build, under the TravTrack lock, against the committed row it relies on. */
async function buildUnderLock(tx: Db, userId: string, tripId: string) {
  await takeTravTrackLock(tx, userId);
  const held = await tx.travTrackShareSnapshot.findFirst({
    where: { tripId, userId },
    select: { id: true, version: true, buildToken: true },
  });
  // Without a committed row a change made during the build has nothing to be
  // recorded against: commit the pending row again first.
  if (!held) throw new PendingRowGone();
  // Read before any input: what is recorded after this stays recorded.
  const cleared = await recordedRows(tx, held.id);
  const bounds = await boundsOf(tx, userId, tripId);
  const built = bounds ? await buildShareGeometry(tx, userId, bounds) : null;
  if (!bounds || !built || built.geometry.length === 0) {
    await tx.travTrackShareSnapshot.deleteMany({ where: { id: held.id } });
    return null;
  }
  await storeBuilt(tx, held, {
    geometry: built.geometry as unknown as object,
    pointCount: vertexCount(built.geometry),
    sharedFrom: new Date(bounds.fromMs),
    sharedUntil: new Date(bounds.untilMs),
    homeCircles: built.home ? [built.home] : [],
    buildToken: null,
  });
  const row = await tx.travTrackShareSnapshot.findUniqueOrThrow({
    where: { id: held.id },
    select: OWNER_SELECT,
  });
  // The owner's share starts over from what this build read: the trip,
  // its flights and the home as they were when it read them.
  await clearCaptured(tx, held.id, cleared);
  return ownerView(tx, userId, row);
}

/**
 * A failed build removes the pending row it committed — under the TravTrack
 * lock, so never while another build holds it, and only if it still carries
 * this build's token, so never the row another build committed or stored a
 * route in.
 */
async function dropOwnPendingRow(userId: string, tripId: string, token: string) {
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    await tx.travTrackShareSnapshot.deleteMany({
      where: { tripId, userId, version: PENDING_VERSION, buildToken: token },
    });
  });
}

/**
 * `PUT /trips/:id/share-snapshot`: the owner shares (or refreshes) the route.
 * Under the TravTrack lock, so a deletion or a zone write cannot interleave
 * with the selection; the version rises on every share.
 *
 * Flight, trip and settings writes do not take that lock, so a restriction
 * can be recorded while the build runs. The build clears only what was
 * recorded BEFORE it read its inputs (the rows and their record numbers it
 * read first); anything recorded later — a repeat of a captured restriction
 * included — stays and narrows the new share too. For the same reason a
 * first share commits a pending row before the build: without a committed row
 * the triggers would have nothing to record a change made during the build
 * against. Two first shares at once rely on the same pending row; only the
 * one that committed it may remove it on failure (`dropOwnPendingRow`), and a
 * build that finds it removed commits it again before reading anything.
 *
 * Once the build has read its row, a revoke wins: it waits for the lock, and
 * a row removed by any other path while the build ran is never written back
 * (`storeBuilt`) — the share answers `TRAVTRACK_SHARE_REVOKED`.
 */
export async function shareTripRoute(userId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  const token = randomUUID();
  let committedPending = false;
  let snapshot: Awaited<ReturnType<typeof ownerView>> | null = null;
  try {
    for (let attempt = 1; ; attempt++) {
      const { count } = await prisma.travTrackShareSnapshot.createMany({
        data: [
          {
            userId,
            tripId,
            geometry: [],
            pointCount: 0,
            version: PENDING_VERSION,
            buildToken: token,
          },
        ],
        skipDuplicates: true,
      });
      committedPending = committedPending || count > 0;
      try {
        snapshot = await prisma.$transaction((tx) => buildUnderLock(tx, userId, tripId), {
          timeout: 60_000,
        });
        break;
      } catch (err) {
        if (err instanceof RowRevoked) {
          throw new AppError(
            "The route was revoked while it was being shared",
            409,
            "TRAVTRACK_SHARE_REVOKED"
          );
        }
        if (!(err instanceof PendingRowGone) && !(err instanceof RowMoved)) throw err;
        if (attempt >= MAX_BUILD_ATTEMPTS) {
          throw new AppError(
            "The route is being shared by another request",
            409,
            "TRAVTRACK_SHARE_BUSY"
          );
        }
      }
    }
  } catch (err) {
    // A build that failed leaves no pending row of its own behind.
    if (committedPending) {
      try {
        await dropOwnPendingRow(userId, tripId, token);
      } catch (cleanupErr) {
        logger.error(
          { err: cleanupErr, tripId },
          "TravTrack share: removing the failed build's pending row failed"
        );
      }
    }
    throw err;
  }
  if (!snapshot || snapshot.pointCount === 0) {
    throw new AppError(
      "Nothing of this trip's TravTrack line may be shown",
      409,
      "TRAVTRACK_ROUTE_EMPTY"
    );
  }
  return snapshot;
}

/**
 * `DELETE /trips/:id/share-snapshot`: revoked for every recipient at once.
 * Under the TravTrack lock, so it never lands inside a build that has read its
 * row: it waits for that build and then removes what it stored.
 */
export async function revokeTripRoute(userId: string, tripId: string): Promise<boolean> {
  const count = await prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const res = await tx.travTrackShareSnapshot.deleteMany({ where: { tripId, userId } });
      return res.count;
    },
    { maxWait: 10_000, timeout: 70_000 }
  );
  return count > 0;
}

/** The owner's own view of what is shared, or null. */
export async function tripRouteSnapshot(userId: string, tripId: string) {
  const row = await prisma.travTrackShareSnapshot.findFirst({
    where: { tripId, userId, version: { gt: PENDING_VERSION } },
    select: OWNER_SELECT,
  });
  return row ? ownerView(prisma, userId, row) : null;
}

/**
 * `GET /trips/:id/shared-route` for a recipient: `tripId` is the READER's own
 * copy. The routes are those of the other members of its share group who
 * shared one and whose changes reach the reader (an accepted consent, an
 * active account — `receivingMembers`, the rule every shared write follows).
 * Geometry, version and the sharer's display name only; never a point, a
 * time or a device.
 *
 * Each is the stored geometry narrowed at read time by the rules in force NOW
 * (`shareNarrow.ts`) — so a change the stored copy missed (a flight added, a
 * home moved, a date changed by any path) never reaches a recipient — and no
 * raw point is read.
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
    where: {
      userId: { not: readerId },
      version: { gt: PENDING_VERSION },
      trip: { shareGroupId: groupId },
    },
    select: {
      userId: true,
      ...OWNER_SELECT,
      user: { select: PERSON_SELECT },
    },
    orderBy: { trip: { createdAt: "asc" } },
  });
  const routes: Array<{ version: number; sharedBy: string; geometry: LonLat[][] }> = [];
  for (const s of snapshots) {
    const reached = await receivingMembers(prisma, groupId, s.userId);
    if (!reached.some((m) => m.userId === readerId)) continue;
    const geometry = untimed(await narrowedRoute(prisma, s.userId, s));
    if (geometry.length === 0) continue;
    routes.push({
      version: s.version,
      sharedBy: toPerson(s.user).displayName,
      geometry,
    });
  }
  return routes;
}
