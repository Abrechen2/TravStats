import type { Cruise, CruiseLeg, CruiseStop, Prisma } from "../../../prisma";
import { SHARED_SOURCE } from "../copyEntries";
import {
  CRUISE_FACT_FIELDS,
  CRUISE_LEG_FACT_FIELDS,
  CRUISE_STOP_FACT_FIELDS,
  cruiseFacts,
  cruiseLegFacts,
  cruiseStopFacts,
  pickFacts,
  type CruiseFactField,
  type CruiseLegFactField,
  type CruiseStopFactField,
} from "../facts";
import { joinLabel, plainData, type EntityAdapter, type SharedRow } from "./types";

/**
 * A cruise with its port calls (`stops`) and computed legs (`legs`) as two
 * pseudo-facts: a change to any call is a change to the cruise's itinerary.
 */

type StopFacts = Pick<CruiseStop, CruiseStopFactField>;
type LegFacts = Pick<CruiseLeg, CruiseLegFactField>;

const INCLUDE = {
  stops: { orderBy: [{ dayNumber: "asc" }, { id: "asc" }] },
  legs: { orderBy: { ordinal: "asc" } },
} as const satisfies Prisma.CruiseInclude;

type CruiseWithParts = Cruise & { stops: CruiseStop[]; legs: CruiseLeg[] };

function cruiseRow(row: CruiseWithParts): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: {
      ...pickFacts(row, CRUISE_FACT_FIELDS),
      stops: row.stops.map((s) => pickFacts(s, CRUISE_STOP_FACT_FIELDS)),
      legs: row.legs.map((l) => pickFacts(l, CRUISE_LEG_FACT_FIELDS)),
    },
    label: joinLabel(row.cruiseLine, row.shipNameOverride ?? row.routeName),
    zones: { startDay: row.startZone, endDay: row.endZone },
  };
}

/**
 * Port calls are matched by position: the n-th call of the source onto the
 * n-th call of the copy, so a member's own excursion note stays on its day.
 * Extra calls are added, surplus calls removed.
 */
async function applyStops(
  c: Parameters<EntityAdapter["apply"]>[0],
  cruiseId: string,
  stops: StopFacts[]
): Promise<void> {
  const current = await c.cruiseStop.findMany({
    where: { cruiseId },
    orderBy: [{ dayNumber: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (let i = 0; i < stops.length; i += 1) {
    const facts = cruiseStopFacts(stops[i]);
    if (current[i]) await c.cruiseStop.update({ where: { id: current[i].id }, data: facts });
    else await c.cruiseStop.create({ data: { ...facts, cruiseId } });
  }
  const surplus = current.slice(stops.length).map((s) => s.id);
  if (surplus.length > 0) await c.cruiseStop.deleteMany({ where: { id: { in: surplus } } });
}

export const cruiseAdapter: EntityAdapter = {
  entity: "cruise",
  fields: [...CRUISE_FACT_FIELDS, "stops", "legs"],
  async load(c, ids) {
    const rows = await c.cruise.findMany({ where: { id: { in: [...ids] } }, include: INCLUDE });
    return rows.map(cruiseRow);
  },
  async copiesOf(c, shareKey) {
    return (await c.cruise.findMany({ where: { shareKey }, include: INCLUDE })).map(cruiseRow);
  },
  async setKey(c, id, key) {
    await c.cruise.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.cruise.create({
      data: {
        ...cruiseFacts(source.facts as Pick<Cruise, CruiseFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
        dataSource: SHARED_SOURCE,
        stops: { create: (source.facts.stops as StopFacts[]).map((s) => cruiseStopFacts(s)) },
        legs: { create: (source.facts.legs as LegFacts[]).map((l) => cruiseLegFacts(l)) },
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, CRUISE_FACT_FIELDS);
    if (Object.keys(data).length > 0) {
      await c.cruise.update({
        where: { id: copy.id },
        data: data as Prisma.CruiseUncheckedUpdateInput,
      });
    }
    if (keys.includes("stops")) await applyStops(c, copy.id, values.stops as StopFacts[]);
    if (keys.includes("legs")) {
      // Computed rows with nothing private on them: replaced as a whole.
      await c.cruiseLeg.deleteMany({ where: { cruiseId: copy.id } });
      await c.cruiseLeg.createMany({
        data: (values.legs as LegFacts[]).map((l) => ({ ...cruiseLegFacts(l), cruiseId: copy.id })),
      });
    }
  },
  async remove(c, id) {
    await c.cruise.delete({ where: { id } });
  },
};
