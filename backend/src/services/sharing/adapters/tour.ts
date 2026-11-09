import type { Prisma, TripRoute } from "../../../prisma";
import { Prisma as PrismaRuntime } from "../../../prisma";
import type { DbTransaction } from "../../../db";
import {
  TOUR_FACT_FIELDS,
  TOUR_TRACK_FACT_FIELDS,
  TOUR_TRACK_JSON_FIELDS,
  pickFacts,
  tourFacts,
  tourTrackFacts,
  trackKeys,
  type TourFactField,
} from "../facts";
import {
  ROUTE_INCLUDE,
  partsOf,
  writeParts,
  type LegWire,
  type RouteWithParts,
  type StationWire,
} from "./routeParts";
import { plainData, type EntityAdapter, type SharedRow } from "./types";

/**
 * A tour on a trip (tours-own-domain T1b): the roadtrip's route (stations and legs, one engine —
 * `routeParts.ts`) plus its RECORDED TRACKS as a third pseudo-fact (`tracks`), which a roadtrip
 * never carries. What stays behind: the source record's own id (`externalRef`, a Strava activity or
 * HealthKit workout), the tour's anchor station, notes, tags, odometer, expenses — and everything
 * of the trip around it.
 *
 * A track has no share key column; its identity is derived (`trackKeys`: source and span), the
 * same on both sides of a copy. Tracks are matched by it. A track the sender dropped is removed
 * from a copy only when the change says the sender HAD it (`previous`): a copy never loses a track
 * it was not told about, and a track the member recorded themselves is theirs.
 */

const KIND = "tour";

export interface TrackWire {
  key: string;
  [field: string]: unknown;
}

const INCLUDE = {
  ...ROUTE_INCLUDE,
  tracks: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.TripRouteInclude;

type TourRow = RouteWithParts & { tracks: Prisma.TripRouteTrackGetPayload<object>[] };

async function tourRows(c: DbTransaction, rows: TourRow[]): Promise<SharedRow[]> {
  const parts = await partsOf(c, rows);
  return rows.map((row) => {
    const keys = trackKeys(row.tracks);
    const tracks: TrackWire[] = row.tracks.map((t, i) => ({ key: keys[i], ...tourTrackFacts(t) }));
    return {
      id: row.id,
      userId: row.userId,
      tripId: row.tripId,
      shareKey: row.shareKey,
      facts: { ...pickFacts(row, TOUR_FACT_FIELDS), ...parts.get(row.id)!, tracks },
      label: row.name,
      zones: {},
    };
  });
}

function trackData(track: TrackWire) {
  const facts = pickFacts(track, TOUR_TRACK_FACT_FIELDS);
  const data: Record<string, unknown> = { ...facts };
  for (const f of TOUR_TRACK_JSON_FIELDS) {
    data[f] = facts[f] === null ? PrismaRuntime.DbNull : (facts[f] as Prisma.InputJsonValue);
  }
  return data as Omit<Prisma.TripRouteTrackUncheckedCreateInput, "routeId" | "externalRef">;
}

/**
 * The copy's tracks made to carry `tracks`, matched by key. `dropped` are the keys the sender held
 * before this change and no longer does. `externalRef` stays null on every copy: the source
 * record is the sender's.
 */
async function writeTracks(
  c: DbTransaction,
  routeId: string,
  tracks: TrackWire[],
  dropped: ReadonlySet<string>
): Promise<void> {
  const current = await c.tripRouteTrack.findMany({
    where: { routeId },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const ownKeys = trackKeys(current);
  const byKey = new Map(current.map((t, i) => [ownKeys[i], t.id]));
  for (const track of tracks) {
    const data = trackData(track);
    const id = byKey.get(track.key);
    if (id) await c.tripRouteTrack.update({ where: { id }, data });
    else await c.tripRouteTrack.create({ data: { ...data, routeId } });
  }
  const goneIds = [...dropped].flatMap((key) => {
    const id = byKey.get(key);
    return id ? [id] : [];
  });
  if (goneIds.length > 0) await c.tripRouteTrack.deleteMany({ where: { id: { in: goneIds } } });
}

const keysOf = (tracks: unknown): string[] =>
  Array.isArray(tracks) ? (tracks as TrackWire[]).map((t) => t.key) : [];

export const tourAdapter: EntityAdapter = {
  entity: "tour",
  fields: [...TOUR_FACT_FIELDS, "stations", "routeLegs", "tracks"],
  async load(c, ids) {
    const rows = await c.tripRoute.findMany({
      where: { id: { in: [...ids] }, kind: KIND },
      include: INCLUDE,
    });
    return tourRows(c, rows);
  },
  async copiesOf(c, shareKey, groupId) {
    const rows = await c.tripRoute.findMany({
      where: { shareKey, kind: KIND, trip: { shareGroupId: groupId } },
      include: INCLUDE,
    });
    return tourRows(c, rows);
  },
  async setKey(c, id, key) {
    await c.tripRoute.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.tripRoute.create({
      data: {
        ...tourFacts(source.facts as Pick<TripRoute, TourFactField>),
        kind: KIND,
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    await writeParts(
      c,
      copy.id,
      recipientId,
      source.facts.stations as StationWire[],
      source.facts.routeLegs as LegWire[]
    );
    await writeTracks(c, copy.id, source.facts.tracks as TrackWire[], new Set());
    return copy.id;
  },
  async apply(c, copy, values, keys, previous) {
    const data = plainData(values, keys, TOUR_FACT_FIELDS);
    if (Object.keys(data).length > 0) {
      await c.tripRoute.update({
        where: { id: copy.id },
        data: data as Prisma.TripRouteUncheckedUpdateInput,
      });
    }
    if (keys.includes("stations") || keys.includes("routeLegs")) {
      const stations = (
        keys.includes("stations") ? values.stations : copy.facts.stations
      ) as StationWire[];
      const legs = (
        keys.includes("routeLegs") ? values.routeLegs : copy.facts.routeLegs
      ) as LegWire[];
      await writeParts(c, copy.id, copy.userId, stations, legs);
    }
    if (keys.includes("tracks")) {
      const next = values.tracks as TrackWire[];
      const now = new Set(keysOf(next));
      const dropped = new Set(keysOf(previous?.tracks).filter((k) => !now.has(k)));
      await writeTracks(c, copy.id, next, dropped);
    }
  },
  async remove(c, id) {
    await c.tripStop.deleteMany({ where: { routeId: id } });
    await c.tripRoute.delete({ where: { id } });
  },
};
