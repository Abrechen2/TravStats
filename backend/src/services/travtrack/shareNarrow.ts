import { z } from "zod";

import { prisma, type DbTransaction } from "../../db";
import logger from "../../utils/logger";
import {
  TRIP_RECORDING_TRIP_SELECT,
  tripRecordingBounds,
  type TripRecordingBounds,
} from "../tripRecording/bounds";
import type { RecordingBreak } from "../tripRecording/segments";
import type { ZoneCircle } from "./classify";
import { privacyCirclesFor } from "./privacyCircles";
import { privacyCutBy, type LonLat } from "./privacyCut";

/**
 * A shared trip's route after the owner shared it (TravTrack plan T7, Codex
 * review of the snapshot): the stored geometry is the ceiling. Only the
 * owner's own share selects points (`shareSnapshot.ts`); everything after it —
 * a deletion, a zone, a moved home, a trip's new days, a flight — may only
 * take vertices away, and a recipient's read serves the stored geometry
 * narrowed by the rules in force now. Nothing here reads a raw point, so the
 * cost of a read is the stored vertices (at most `SNAPSHOT_MAX_VERTICES`), not
 * the owner's history.
 *
 * Each stored vertex is `[lon, lat, tMs]` — the time is what lets a deletion
 * after the share find its vertices. It never leaves the server: a reader
 * gets `[lon, lat]`. A stored vertex without one is read as nothing (fail
 * closed) until the owner shares again.
 *
 * A revoke wins: an automatic narrowing writes only the row it read, at the
 * version it read (`updateMany`/`deleteMany` on id and version), and never
 * creates one.
 */

type Db = DbTransaction;

/** Nothing within this distance of the owner's home is in a shared route. */
export const SNAPSHOT_HOME_M = 1000;

export type TimedVertex = [number, number, number];
export type TimedGeometry = TimedVertex[][];

const timedGeometry = z.array(
  z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]))
);

/** The stored geometry, or null when it is not the timed shape (then nothing is served). */
export const readStored = (geometry: unknown): TimedGeometry | null => {
  const parsed = timedGeometry.safeParse(geometry);
  return parsed.success ? parsed.data : null;
};

export const vertexCount = (lines: readonly unknown[][]) => lines.reduce((n, l) => n + l.length, 0);

/** What a reader gets: positions only. */
export const untimed = (lines: TimedGeometry): LonLat[][] =>
  lines.map((l) => l.map((v): LonLat => [v[0], v[1]]));

/**
 * Home as far as the circle needs it: a position. Read leniently on purpose —
 * a stored home missing a field the settings form asks for (its zone) must
 * still keep the route away from it, never let it through.
 */
const homePosition = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});

export async function homeCircle(
  db: Pick<Db, "userSettings">,
  userId: string
): Promise<ZoneCircle | null> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { homePlace: true },
  });
  const home = homePosition.safeParse(settings?.homePlace);
  return home.success ? { lat: home.data.lat, lon: home.data.lon, radiusM: SNAPSHOT_HOME_M } : null;
}

export async function boundsOf(db: Db, userId: string, tripId: string) {
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId },
    select: TRIP_RECORDING_TRIP_SELECT,
  });
  return trip ? tripRecordingBounds(userId, trip) : null;
}

/**
 * What the owner shared: the window `[sharedFrom, sharedUntil)` and every home
 * circle in force since. A narrowing or a read may only take away from it.
 */
export type SharedState = {
  sharedFrom: Date | null;
  sharedUntil: Date | null;
  homeCircles: unknown;
};

export const SHARED_STATE_SELECT = {
  sharedFrom: true,
  sharedUntil: true,
  homeCircles: true,
} as const;

const circleList = z.array(
  z.object({
    lat: z.number().finite(),
    lon: z.number().finite(),
    radiusM: z.number().finite().positive(),
  })
);

/** The stored home circles, or null when they cannot be read (then nothing is shared). */
export const homesOf = (state: SharedState): ZoneCircle[] | null => {
  const parsed = circleList.safeParse(state.homeCircles);
  return parsed.success ? parsed.data : null;
};

/**
 * The overlap of the window the owner shared with the trip's current days,
 * the current flights kept as breaks. Null when they no longer overlap, or
 * the window is unknown.
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

/** `list` with each of `more` not already in it. */
export const withCircles = (list: readonly ZoneCircle[], more: readonly ZoneCircle[]) =>
  more.reduce<ZoneCircle[]>(
    (acc, c) => (acc.some((h) => sameCircle(h, c)) ? acc : [...acc, c]),
    [...list]
  );

/** Everything a stored route is narrowed by, as of now. */
export type Narrowing = {
  bounds: TripRecordingBounds;
  /** Every home the route keeps away from: those stored, those passed in, the current one. */
  homes: ZoneCircle[];
  /** Zones in force, former zones that still cover the window, every home. */
  circles: ZoneCircle[];
  /** Deleted spans and the current flights' recorder windows. */
  cuts: RecordingBreak[];
};

export async function narrowingFor(
  db: Db,
  userId: string,
  tripId: string,
  state: SharedState,
  extraHomes: readonly ZoneCircle[] = []
): Promise<Narrowing | null> {
  const current = await boundsOf(db, userId, tripId);
  const bounds = current ? effectiveBounds(current, state) : null;
  const stored = homesOf(state);
  if (!bounds || !stored) return null;
  const [zones, home, deleted] = await Promise.all([
    privacyCirclesFor(userId, bounds.fromMs, db),
    homeCircle(db, userId),
    db.travTrackDeletedRange.findMany({
      where: {
        userId,
        fromAt: { lt: new Date(bounds.untilMs) },
        toAt: { gt: new Date(bounds.fromMs) },
      },
      select: { fromAt: true, toAt: true },
    }),
  ]);
  const homes = withCircles(stored, [...extraHomes, ...(home ? [home] : [])]);
  return {
    bounds,
    homes,
    circles: [...zones, ...homes],
    cuts: [
      ...deleted.map((d): RecordingBreak => [d.fromAt.getTime(), d.toAt.getTime()]),
      ...bounds.flightWindows,
    ],
  };
}

/**
 * The stored route narrowed: every vertex outside the window or inside a cut
 * goes, every line breaks where a cut falls between two vertices (a chord
 * that stepped over a deleted span or a flight), and the result is
 * privacy-cut against every circle. Never adds a vertex.
 */
export function narrow(lines: TimedGeometry, n: Narrowing): TimedGeometry {
  const { fromMs, untilMs } = n.bounds;
  const inCut = (t: number) => n.cuts.some(([a, b]) => t >= a && t <= b);
  const cutBetween = (s: number, t: number) => n.cuts.some(([a, b]) => a <= t && b >= s);
  const pieces: TimedVertex[][] = [];
  for (const line of lines) {
    let current: TimedVertex[] = [];
    const flush = () => {
      if (current.length > 1) pieces.push(current);
      current = [];
    };
    for (const v of line) {
      const t = v[2];
      if (t < fromMs || t >= untilMs || inCut(t)) {
        flush();
        continue;
      }
      const last = current[current.length - 1];
      if (last && (t < last[2] || cutBetween(last[2], t))) flush();
      current.push(v);
    }
    flush();
  }
  return privacyCutBy(pieces, n.circles, (v): LonLat => [v[0], v[1]]);
}

/** The stored route as it may be shown now, or an empty list. */
export async function narrowedRoute(
  db: Db,
  userId: string,
  row: SharedState & { tripId: string; geometry: unknown }
): Promise<TimedGeometry> {
  const lines = readStored(row.geometry);
  if (!lines) return [];
  const n = await narrowingFor(db, userId, row.tripId, row);
  return n ? narrow(lines, n) : [];
}

const NARROW_SELECT = {
  id: true,
  tripId: true,
  version: true,
  geometry: true,
  ...SHARED_STATE_SELECT,
} as const;
const NARROW_ATTEMPTS = 3;

/**
 * Narrows one stored route in place: written only where the row is still the
 * one read (id and version); a row that went meanwhile stays gone. A row that
 * moved on (another narrowing, the owner sharing again) is read again and
 * narrowed once more — whether this one was to shrink it or to remove it.
 * Illegible geometry is left as it is: it is served to
 * nobody, and the owner's next share replaces it.
 */
async function narrowOne(db: Db, userId: string, id: string, extraHomes: readonly ZoneCircle[]) {
  for (let attempt = 0; attempt < NARROW_ATTEMPTS; attempt++) {
    const row = await db.travTrackShareSnapshot.findFirst({
      where: { id, userId },
      select: NARROW_SELECT,
    });
    const lines = row ? readStored(row.geometry) : null;
    if (!row || !lines) return;
    const n = await narrowingFor(db, userId, row.tripId, row, extraHomes);
    const kept = n ? narrow(lines, n) : [];
    const guard = { id: row.id, version: row.version };
    if (!n || kept.length === 0) {
      const { count } = await db.travTrackShareSnapshot.deleteMany({ where: guard });
      if (count > 0) return;
      continue;
    }
    const window = {
      sharedFrom: new Date(n.bounds.fromMs),
      sharedUntil: new Date(n.bounds.untilMs),
    };
    const unchanged =
      vertexCount(kept) === vertexCount(lines) &&
      kept.length === lines.length &&
      n.homes.length === (homesOf(row) ?? []).length &&
      window.sharedFrom.getTime() === row.sharedFrom?.getTime() &&
      window.sharedUntil.getTime() === row.sharedUntil?.getTime();
    if (unchanged) return;
    const { count } = await db.travTrackShareSnapshot.updateMany({
      where: guard,
      data: {
        geometry: kept as unknown as object,
        pointCount: vertexCount(kept),
        version: { increment: 1 },
        ...window,
        homeCircles: n.homes,
      },
    });
    if (count > 0) return;
  }
}

/**
 * Narrows the account's stored routes (one trip's, or all) by the rules in
 * force through `db`. `homes` are former homes to keep hidden as well (the
 * one a settings change just replaced). Inside a removal's transaction a
 * failure fails the removal; it never widens anything.
 */
export async function narrowShareSnapshots(
  db: Db,
  userId: string,
  opts: { tripId?: string; homes?: readonly ZoneCircle[] } = {}
): Promise<void> {
  const rows = await db.travTrackShareSnapshot.findMany({
    where: { userId, ...(opts.tripId ? { tripId: opts.tripId } : {}) },
    select: { id: true },
  });
  for (const row of rows) await narrowOne(db, userId, row.id, opts.homes ?? []);
}

/** The `onPointsRemoved` handler (`deleteRange.ts`): the deletion or zone is already in `tx`. */
export const narrowOnPointsRemoved = (tx: Db, userId: string): Promise<void> =>
  narrowShareSnapshots(tx, userId);

/**
 * After a change that removed no point — the home place, a trip's days: in
 * its own transaction, and a failure only logs, because every read narrows
 * by the same rules anyway.
 */
export async function narrowShareSnapshotsAfter(
  userId: string,
  opts: { tripId?: string; homes?: readonly ZoneCircle[] } = {}
): Promise<void> {
  try {
    await prisma.$transaction((tx) => narrowShareSnapshots(tx, userId, opts), { timeout: 60_000 });
  } catch (error) {
    logger.warn({
      operation: "travtrack.share_snapshot.narrow_failed",
      userId,
      tripId: opts.tripId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
