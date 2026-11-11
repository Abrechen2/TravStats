import type { Prisma, TripRoute } from "../../../prisma";
import type { DbTransaction } from "../../../db";
import { ROADTRIP_FACT_FIELDS, pickFacts, roadtripFacts, type RoadtripFactField } from "../facts";
import {
  ROUTE_INCLUDE,
  partsOf,
  writeParts,
  type LegWire,
  type RouteWithParts,
  type StationWire,
} from "./routeParts";
import { plainData, type EntityAdapter, type SharedRow } from "./types";

export type { LegWire, StationWire } from "./routeParts";

/**
 * A roadtrip with its route (forgejo#404, spec 2026-10-17 §6.8): the section
 * itself, its stations (`stations`) and its computed legs (`routeLegs`) as two
 * pseudo-facts, so a change to any station is a change to the route. How those
 * two are keyed and written is `routeParts.ts`, shared with the tour adapter.
 *
 * A tour sits in the same table and is told apart by `kind`: every read here
 * filters on it, so a tour is never loaded, matched or removed as a roadtrip.
 */

const KIND = "roadtrip";

async function routeRows(c: DbTransaction, rows: RouteWithParts[]): Promise<SharedRow[]> {
  const parts = await partsOf(c, rows);
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: { ...pickFacts(row, ROADTRIP_FACT_FIELDS), ...parts.get(row.id)! },
    label: row.name,
    zones: {},
  }));
}

export const roadtripAdapter: EntityAdapter = {
  entity: "roadtrip",
  fields: [...ROADTRIP_FACT_FIELDS, "stations", "routeLegs"],
  async load(c, ids) {
    const rows = await c.tripRoute.findMany({
      where: { id: { in: [...ids] }, kind: KIND },
      include: ROUTE_INCLUDE,
    });
    return routeRows(c, rows);
  },
  async copiesOf(c, shareKey, groupId) {
    const rows = await c.tripRoute.findMany({
      where: { shareKey, kind: KIND, trip: { shareGroupId: groupId } },
      include: ROUTE_INCLUDE,
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
