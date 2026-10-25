import { z } from "zod";

import type { DbTransaction } from "../../db";
import {
  flightRecorderWindows,
  TRIP_RECORDING_TRIP_SELECT,
  tripRecordingBounds,
  tripSpanInstantsIn,
  type TripRecordingBounds,
} from "../tripRecording/bounds";
import type { RecordingBreak } from "../tripRecording/segments";
import { profileZoneFromSettings } from "../../shared/time/profileZone";
import { positionKey, type ZoneCircle } from "./classify";
import type { PointsRemovedCause } from "./deleteRange";
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
 *
 * What restricted the route since the share only accumulates (Codex review,
 * second round): every former home, every span the trip's days had and every
 * flight the trip had are recorded by database triggers in the transaction of
 * the change itself (`travtrack_share_past_*`, migration
 * `travtrack_share_restrictions`), whatever path the change took. A read and a
 * narrowing apply them on top of the rules in force, so widening the days,
 * removing a flight or clearing the home never brings back what they hid.
 * A span without a zone of its own carries the profile zone it was read in, and
 * a profile-zone change records the trip's span in the zone it leaves, so a
 * zone changed and changed back does not either.
 * Each restriction is recorded once (a key over the values that decide it), and
 * a flight only when something that places its recorder window changed, so a
 * read replays distinct restrictions, not writes.
 * Only the owner's own share clears them (`shareSnapshot.ts`).
 */

type Db = DbTransaction;

/**
 * A route the owner's first build has not finished yet (Codex review, third
 * round). It exists so the restriction triggers have a committed row to record
 * against while the build reads its inputs; it serves nothing (no window), no
 * narrowing touches it, and the owner does not see it as a share.
 */
export const PENDING_VERSION = 0;

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

/** A stored home place as the circle a route keeps out of, or null when it names no position. */
const circleOfHome = (place: unknown): ZoneCircle | null => {
  const home = homePosition.safeParse(place);
  return home.success ? { lat: home.data.lat, lon: home.data.lon, radiusM: SNAPSHOT_HOME_M } : null;
};

export async function homeCircle(
  db: Pick<Db, "userSettings">,
  userId: string
): Promise<ZoneCircle | null> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { homePlace: true },
  });
  return circleOfHome(settings?.homePlace);
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
  /** The stored route's row: what restricted it since is recorded against it. */
  id: string;
  sharedFrom: Date | null;
  sharedUntil: Date | null;
  homeCircles: unknown;
};

export const SHARED_STATE_SELECT = {
  id: true,
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
  /** Every home the route keeps away from: those stored, those recorded since, the current one. */
  homes: ZoneCircle[];
  /** Zones in force, former zones that still cover the window, every home. */
  circles: ZoneCircle[];
  /** Deleted spans, and the recorder windows of the trip's flights now and since the share. */
  cuts: RecordingBreak[];
  /** Position keys of points just removed without a tombstone (an import deleted). */
  removedKeys?: ReadonlySet<string>;
};

const TRIP_RECORDING_SPAN_SELECT = {
  startDate: true,
  endDate: true,
  startDay: true,
  endDay: true,
  startZone: true,
  endZone: true,
} as const;

/** A recorded profile zone as `profileZoneOf` reads it: unset or not a zone is UTC. */
const recordedProfileZone = (zone: string | null) =>
  profileZoneFromSettings({ display: { timezone: zone ?? undefined } }).zone;

/**
 * What the triggers recorded against the stored route since the share. A span
 * is read in the profile zone in force when it was recorded — never today's,
 * which would let a zone changed and changed back show what the first change
 * hid.
 */
async function restrictionsSince(db: Db, snapshotId: string) {
  const where = { snapshotId };
  const [spans, flights, homes] = await Promise.all([
    db.travTrackSharePastSpan.findMany({
      where,
      select: { ...TRIP_RECORDING_SPAN_SELECT, profileZone: true },
    }),
    db.travTrackSharePastFlight.findMany({ where }),
    db.travTrackSharePastHome.findMany({ where, select: { homePlace: true } }),
  ]);
  const instants = spans.map((span) =>
    tripSpanInstantsIn(span, recordedProfileZone(span.profileZone))
  );
  return {
    // A span the server cannot state any more narrows to nothing (fail closed).
    spans: instants,
    flightWindows: await flightRecorderWindows(flights),
    // A recorded home that names no position kept nothing away when it was in force either.
    homes: homes.map((h) => circleOfHome(h.homePlace)).filter((c): c is ZoneCircle => c !== null),
  };
}

/** `bounds` narrowed to each recorded span, or null when one is unknown or nothing is left. */
function withinSpans(
  bounds: TripRecordingBounds,
  spans: ReadonlyArray<Pick<TripRecordingBounds, "fromMs" | "untilMs"> | null>
): TripRecordingBounds | null {
  let fromMs = bounds.fromMs;
  let untilMs = bounds.untilMs;
  for (const span of spans) {
    if (!span) return null;
    fromMs = Math.max(fromMs, span.fromMs);
    untilMs = Math.min(untilMs, span.untilMs);
  }
  return fromMs < untilMs ? { ...bounds, fromMs, untilMs } : null;
}

export async function narrowingFor(
  db: Db,
  userId: string,
  tripId: string,
  state: SharedState
): Promise<Narrowing | null> {
  const current = await boundsOf(db, userId, tripId);
  const shared = current ? effectiveBounds(current, state) : null;
  const stored = homesOf(state);
  if (!shared || !stored) return null;
  const since = await restrictionsSince(db, state.id);
  const bounds = withinSpans(shared, since.spans);
  if (!bounds) return null;
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
  const homes = withCircles(stored, [...since.homes, ...(home ? [home] : [])]);
  return {
    bounds,
    homes,
    circles: [...zones, ...homes],
    cuts: [
      ...deleted.map((d): RecordingBreak => [d.fromAt.getTime(), d.toAt.getTime()]),
      ...bounds.flightWindows,
      ...since.flightWindows,
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
  const removed = (v: TimedVertex) =>
    n.removedKeys?.has(positionKey({ tS: Math.floor(v[2] / 1000), lon: v[0], lat: v[1] })) ?? false;
  const pieces: TimedVertex[][] = [];
  for (const line of lines) {
    let current: TimedVertex[] = [];
    const flush = () => {
      if (current.length > 1) pieces.push(current);
      current = [];
    };
    for (const v of line) {
      const t = v[2];
      if (t < fromMs || t >= untilMs || inCut(t) || removed(v)) {
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
 * Illegible geometry is left as it is: it is served to nobody, and the
 * owner's next share replaces it.
 */
async function narrowOne(db: Db, userId: string, id: string, removedKeys?: ReadonlySet<string>) {
  for (let attempt = 0; attempt < NARROW_ATTEMPTS; attempt++) {
    const row = await db.travTrackShareSnapshot.findFirst({
      where: { id, userId },
      select: NARROW_SELECT,
    });
    const lines = row ? readStored(row.geometry) : null;
    // A pending first share (version 0) is the owner's build's to finish.
    if (!row || !lines || row.version === PENDING_VERSION) return;
    const found = await narrowingFor(db, userId, row.tripId, row);
    const n = found && removedKeys && removedKeys.size > 0 ? { ...found, removedKeys } : found;
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
 * force through `db`, in the transaction of the change that calls it: a
 * failure here fails the change. It never widens anything.
 */
export async function narrowShareSnapshots(
  db: Db,
  userId: string,
  opts: { tripId?: string; removedKeys?: ReadonlySet<string> } = {}
): Promise<void> {
  const rows = await db.travTrackShareSnapshot.findMany({
    where: { userId, ...(opts.tripId ? { tripId: opts.tripId } : {}) },
    select: { id: true },
  });
  for (const row of rows) await narrowOne(db, userId, row.id, opts.removedKeys);
}

/**
 * The `onPointsRemoved` handler (`deleteRange.ts`): the deletion or zone is
 * already in `tx`. A removal that leaves no tombstone (an import deleted)
 * names the removed points by position key; exactly the stored vertices that
 * were those points go — never another source's vertex in the same hours —
 * and the line breaks where they were. The stored route only ever shrinks,
 * so the keys need not be remembered past this narrowing.
 */
export const narrowOnPointsRemoved = (
  tx: Db,
  userId: string,
  cause?: PointsRemovedCause
): Promise<void> =>
  narrowShareSnapshots(tx, userId, {
    removedKeys: cause?.kind === "origin" ? cause.keys : undefined,
  });
