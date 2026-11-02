import { randomUUID } from "crypto";

import type { DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import type { TripRoute, TripRouteLeg, TripStop } from "../../../prisma";
import {
  ROADTRIP_FACT_FIELDS,
  ROADTRIP_LEG_FACT_FIELDS,
  pickFacts,
  roadtripFacts,
  roadtripStationFacts,
  type RoadtripFactField,
  type RoadtripLegFactField,
  type RoadtripStationFactField,
} from "../facts";
import { refsOf, resolveRef, type EntryRef } from "./stop";
import { plainData, type EntityAdapter, type SharedRow } from "./types";

/**
 * A roadtrip with its route (forgejo#404, spec 2026-10-17 §6.8): the section
 * itself, its stations (`stations`) and its computed legs (`routeLegs`) as two
 * pseudo-facts, so a change to any station is a change to the route.
 *
 * Stations are matched by their own share key, never by position: inserting a
 * stop must not slide the recipient's notes and expenses one station along (the
 * lesson of `cruiseStopMatch.ts`). A station gets its key the first time its
 * roadtrip is read while keyed. Legs are identified by their two endpoint keys,
 * as in the database; a leg's ferry crossing travels as that ferry's share key,
 * resolved in each account to its own copy.
 */

type StationFacts = Pick<TripStop, RoadtripStationFactField>;
type LegFacts = Pick<TripRouteLeg, RoadtripLegFactField>;

export interface StationWire extends StationFacts {
  key: string;
  lodgingStayRef: EntryRef | null;
}
export interface LegWire extends LegFacts {
  fromKey: string;
  toKey: string;
  ferryKey: string | null;
}

type RouteWithParts = TripRoute & {
  stops: TripStop[];
  legs: (TripRouteLeg & { ferryJourney: { shareKey: string | null } | null })[];
};

const INCLUDE = {
  stops: { where: { routeOrderIdx: { not: null } }, orderBy: { routeOrderIdx: "asc" } },
  legs: { include: { ferryJourney: { select: { shareKey: true } } } },
} as const satisfies Prisma.TripRouteInclude;

/**
 * Keys the stations of a roadtrip that is shared (keyed, or on a trip of a share group) and has
 * none yet; idempotent. A roadtrip not shared is left alone: reading it writes nothing.
 */
async function ensureStationKeys(c: DbTransaction, rows: RouteWithParts[]): Promise<void> {
  const tripIds = [...new Set(rows.flatMap((r) => (r.tripId ? [r.tripId] : [])))];
  const grouped = new Set(
    (
      await c.trip.findMany({
        where: { id: { in: tripIds }, shareGroupId: { not: null } },
        select: { id: true },
      })
    ).map((t) => t.id)
  );
  for (const row of rows) {
    if (!row.shareKey && !(row.tripId && grouped.has(row.tripId))) continue;
    for (const stop of row.stops) {
      if (stop.shareKey) continue;
      stop.shareKey = randomUUID();
      await c.tripStop.update({ where: { id: stop.id }, data: { shareKey: stop.shareKey } });
    }
  }
}

async function routeRows(c: DbTransaction, rows: RouteWithParts[]): Promise<SharedRow[]> {
  await ensureStationKeys(c, rows);
  const stayIds = rows.flatMap((r) =>
    r.stops.flatMap((s) => (s.lodgingStayId ? [s.lodgingStayId] : []))
  );
  const refs = await refsOf(c, stayIds);
  return rows.map((row) => {
    const keyOf = new Map(row.stops.map((s) => [s.id, s.shareKey]));
    const stations: StationWire[] = row.stops.flatMap((s) =>
      s.shareKey
        ? [
            {
              ...roadtripStationFacts(s),
              key: s.shareKey,
              lodgingStayRef: (s.lodgingStayId && refs.get(s.lodgingStayId)) || null,
            },
          ]
        : []
    );
    const legs: LegWire[] = row.legs.flatMap((l) => {
      const fromKey = keyOf.get(l.fromStopId);
      const toKey = keyOf.get(l.toStopId);
      return fromKey && toKey
        ? [
            {
              ...pickFacts(l, ROADTRIP_LEG_FACT_FIELDS),
              fromKey,
              toKey,
              ferryKey: l.ferryJourney?.shareKey ?? null,
            },
          ]
        : [];
    });
    return {
      id: row.id,
      userId: row.userId,
      tripId: row.tripId,
      shareKey: row.shareKey,
      facts: { ...pickFacts(row, ROADTRIP_FACT_FIELDS), stations, routeLegs: legs },
      label: row.name,
      zones: {},
      excluded: row.kind !== "roadtrip",
    };
  });
}

/** The recipient's stations of this roadtrip made equal to `stations`, by key. Returns key → stop id. */
async function applyStations(
  c: DbTransaction,
  routeId: string,
  userId: string,
  stations: StationWire[]
): Promise<Map<string, string>> {
  const current = await c.tripStop.findMany({ where: { routeId } });
  const byKey = new Map(current.flatMap((s) => (s.shareKey ? [[s.shareKey, s] as const] : [])));
  // Free every position first: (routeId, routeOrderIdx) is unique.
  await c.tripStop.updateMany({ where: { routeId }, data: { routeOrderIdx: null } });
  const ids = new Map<string, string>();
  for (const station of stations) {
    const { key, lodgingStayRef, ...facts } = station;
    const data = {
      ...roadtripStationFacts(facts),
      lodgingStayId: await resolveRef(c, lodgingStayRef, userId),
    };
    const own = byKey.get(key);
    if (own) {
      await c.tripStop.update({ where: { id: own.id }, data });
      ids.set(key, own.id);
    } else {
      const created = await c.tripStop.create({
        data: { ...data, routeId, tripId: null, shareKey: key },
        select: { id: true },
      });
      ids.set(key, created.id);
    }
  }
  const sourceKeys = new Set(stations.map((s) => s.key));
  // What the sender dropped goes — unless the member wrote on it: their words are not the
  // sender's to delete. Such a station stays, after the others, off the sender's key.
  let next = stations.length;
  for (const s of current) {
    if (s.shareKey && sourceKeys.has(s.shareKey)) continue;
    const [expenses, photos, anchored] = await Promise.all([
      c.tripExpense.count({ where: { stopId: s.id } }),
      c.tripPhoto.count({ where: { stopId: s.id } }),
      c.tripRoute.count({ where: { anchorStopId: s.id } }),
    ]);
    if (s.shareKey && !s.notes?.trim() && expenses + photos + anchored === 0) {
      await c.tripStop.delete({ where: { id: s.id } });
    } else {
      await c.tripStop.update({
        where: { id: s.id },
        data: { routeOrderIdx: next++, shareKey: null },
      });
    }
  }
  return ids;
}

async function applyLegs(
  c: DbTransaction,
  routeId: string,
  userId: string,
  stationIds: Map<string, string>,
  legs: LegWire[]
): Promise<void> {
  const wanted = new Set<string>();
  for (const leg of legs) {
    const fromStopId = stationIds.get(leg.fromKey);
    const toStopId = stationIds.get(leg.toKey);
    if (!fromStopId || !toStopId) continue;
    wanted.add(`${fromStopId}>${toStopId}`);
    const facts = pickFacts(leg, ROADTRIP_LEG_FACT_FIELDS);
    const data = {
      ...facts,
      waypoints:
        facts.waypoints === null ? Prisma.DbNull : (facts.waypoints as Prisma.InputJsonValue),
    };
    const row = await c.tripRouteLeg.upsert({
      where: { routeId_fromStopId_toStopId: { routeId, fromStopId, toStopId } },
      create: { ...data, routeId, fromStopId, toStopId },
      update: data,
      select: { id: true },
    });
    if (leg.ferryKey) await linkFerry(c, userId, row.id, leg.ferryKey);
    else {
      // The sender unlinked the crossing: a shared crossing (it has a key) comes off the leg too.
      await c.ferryJourney.updateMany({
        where: { roadtripLegId: row.id, userId, shareKey: { not: null } },
        data: { roadtripLegId: null },
      });
    }
  }
  const mine = [...stationIds.values()];
  const stale = (
    await c.tripRouteLeg.findMany({
      where: { routeId, fromStopId: { in: mine }, toStopId: { in: mine } },
      select: { id: true, fromStopId: true, toStopId: true },
    })
  ).filter((l) => !wanted.has(`${l.fromStopId}>${l.toStopId}`));
  if (stale.length > 0) {
    await c.tripRouteLeg.deleteMany({ where: { id: { in: stale.map((l) => l.id) } } });
  }
}

/** Point the member's copy of a crossing at this leg; no copy of the ferry means no link. */
async function linkFerry(
  c: DbTransaction,
  userId: string,
  legId: string,
  ferryKey: string
): Promise<void> {
  const ferry = await c.ferryJourney.findFirst({
    where: { userId, shareKey: ferryKey },
    select: { id: true },
  });
  if (!ferry) return;
  // A leg carries one crossing (`roadtrip_leg_id` is unique).
  await c.ferryJourney.updateMany({
    where: { roadtripLegId: legId, id: { not: ferry.id } },
    data: { roadtripLegId: null },
  });
  await c.ferryJourney.update({ where: { id: ferry.id }, data: { roadtripLegId: legId } });
}

async function writeParts(
  c: DbTransaction,
  routeId: string,
  userId: string,
  stations: StationWire[],
  legs: LegWire[]
): Promise<void> {
  const ids = await applyStations(c, routeId, userId, stations);
  await applyLegs(c, routeId, userId, ids, legs);
}

export const roadtripAdapter: EntityAdapter = {
  entity: "roadtrip",
  fields: [...ROADTRIP_FACT_FIELDS, "stations", "routeLegs"],
  async load(c, ids) {
    const rows = await c.tripRoute.findMany({ where: { id: { in: [...ids] } }, include: INCLUDE });
    return routeRows(c, rows);
  },
  async copiesOf(c, shareKey, groupId) {
    const rows = await c.tripRoute.findMany({
      where: { shareKey, trip: { shareGroupId: groupId } },
      include: INCLUDE,
    });
    return routeRows(c, rows);
  },
  async setKey(c, id, key) {
    await c.tripRoute.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.tripRoute.create({
      data: {
        ...roadtripFacts(source.facts as Pick<TripRoute, RoadtripFactField>),
        kind: "roadtrip",
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
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, ROADTRIP_FACT_FIELDS);
    if (Object.keys(data).length > 0) {
      await c.tripRoute.update({
        where: { id: copy.id },
        data: data as Prisma.TripRouteUncheckedUpdateInput,
      });
    }
    if (keys.includes("stations") || keys.includes("routeLegs")) {
      // Legs hang off stations: either changing means the whole route is re-read.
      const stations = (
        keys.includes("stations") ? values.stations : copy.facts.stations
      ) as StationWire[];
      const legs = (
        keys.includes("routeLegs") ? values.routeLegs : copy.facts.routeLegs
      ) as LegWire[];
      await writeParts(c, copy.id, copy.userId, stations, legs);
    }
  },
  async remove(c, id) {
    await c.tripStop.deleteMany({ where: { routeId: id } });
    await c.tripRoute.delete({ where: { id } });
  },
};
