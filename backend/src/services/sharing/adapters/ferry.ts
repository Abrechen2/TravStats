import type { FerryJourney, Prisma } from "../../../prisma";
import { haversineKm } from "../../../shared/geo/haversine";
import { localDay } from "../../../shared/time/instant";
import { FERRY_FACT_FIELDS, ferryFacts, pickFacts, type FerryFactField } from "../facts";
import { joinLabel, plainData, type EntityAdapter, type SharedRow } from "./types";

/** A crossing: facts are its own columns, as for bus and rail. */
const FERRY_JSON = ["geometry"] as const;

/**
 * Two terminals are the same within this distance. A port's pin is typed or
 * geocoded by each member on their own — Kiel Schwedenkai lands a few hundred
 * metres apart depending on who looked it up — while two terminals of one city
 * served by the same line on the same day are rare enough to stay apart.
 */
export const SAME_TERMINAL_KM = 1;
/** A local departure day is the same instant ± 14 h of offset; two days cover it. */
const WINDOW_MS = 2 * 86_400_000;

interface Point {
  lat: number;
  lon: number;
}
const sameTerminal = (a: Point, b: Point) => haversineKm(a, b) <= SAME_TERMINAL_KM;

function ferryRow(row: FerryJourney): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: pickFacts(row, FERRY_FACT_FIELDS),
    label: joinLabel(row.operator, row.vesselName, `${row.depStationName} → ${row.arrStationName}`),
    zones: {
      departureTime: row.depTimezone,
      actualDepartureTime: row.depTimezone,
      arrivalTime: row.arrTimezone,
      actualArrivalTime: row.arrTimezone,
    },
  };
}

export const ferryAdapter: EntityAdapter = {
  entity: "ferry",
  fields: FERRY_FACT_FIELDS,
  async load(c, ids) {
    return (await c.ferryJourney.findMany({ where: { id: { in: [...ids] } } })).map(ferryRow);
  },
  async copiesOf(c, shareKey, groupId) {
    return (
      await c.ferryJourney.findMany({ where: { shareKey, trip: { shareGroupId: groupId } } })
    ).map(ferryRow);
  },
  async setKey(c, id, key) {
    await c.ferryJourney.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.ferryJourney.create({
      data: {
        ...ferryFacts(source.facts as Pick<FerryJourney, FerryFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, FERRY_FACT_FIELDS, FERRY_JSON);
    await c.ferryJourney.update({
      where: { id: copy.id },
      data: data as Prisma.FerryJourneyUncheckedUpdateInput,
    });
  },
  async remove(c, id) {
    await c.ferryJourney.delete({ where: { id } });
  },
  /** The recipient's own crossing: the same two terminals on the same local day. */
  async ownMatches(c, source, recipientId) {
    const f = source.facts as Pick<FerryJourney, FerryFactField>;
    const zone = f.depTimezone;
    if (!zone) return [];
    const day = localDay(f.departureTime, zone);
    const at = f.departureTime.getTime();
    const rows = await c.ferryJourney.findMany({
      where: {
        userId: recipientId,
        shareKey: null,
        status: { not: "cancelled" },
        departureTime: { gte: new Date(at - WINDOW_MS), lte: new Date(at + WINDOW_MS) },
      },
      select: {
        id: true,
        tripId: true,
        departureTime: true,
        depTimezone: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
      },
      orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    });
    return rows
      .filter(
        (r) =>
          localDay(r.departureTime, r.depTimezone ?? zone) === day &&
          sameTerminal({ lat: r.depLat, lon: r.depLon }, { lat: f.depLat, lon: f.depLon }) &&
          sameTerminal({ lat: r.arrLat, lon: r.arrLon }, { lat: f.arrLat, lon: f.arrLon })
      )
      .map((r) => ({ id: r.id, tripId: r.tripId }));
  },
};
