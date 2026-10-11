import type { BusJourney, Prisma } from "../../../prisma";
import { BUS_FACT_FIELDS, busFacts, pickFacts, type BusFactField } from "../facts";
import { joinLabel, plainData, type EntityAdapter, type SharedRow } from "./types";

/** A bus ride: facts are its own columns and nothing else, as for rail. */
const BUS_JSON = ["geometry"] as const;

function busRow(row: BusJourney): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: pickFacts(row, BUS_FACT_FIELDS),
    label: joinLabel(row.operator, row.lineName, `${row.depStationName} → ${row.arrStationName}`),
    zones: {
      departureTime: row.depTimezone,
      actualDepartureTime: row.depTimezone,
      arrivalTime: row.arrTimezone,
      actualArrivalTime: row.arrTimezone,
    },
  };
}

export const busAdapter: EntityAdapter = {
  entity: "bus",
  fields: BUS_FACT_FIELDS,
  async load(c, ids) {
    return (await c.busJourney.findMany({ where: { id: { in: [...ids] } } })).map(busRow);
  },
  async copiesOf(c, shareKey, groupId) {
    return (
      await c.busJourney.findMany({ where: { shareKey, trip: { shareGroupId: groupId } } })
    ).map(busRow);
  },
  async setKey(c, id, key) {
    await c.busJourney.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.busJourney.create({
      data: {
        ...busFacts(source.facts as Pick<BusJourney, BusFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, BUS_FACT_FIELDS, BUS_JSON);
    await c.busJourney.update({
      where: { id: copy.id },
      data: data as Prisma.BusJourneyUncheckedUpdateInput,
    });
  },
  async remove(c, id) {
    await c.busJourney.delete({ where: { id } });
  },
};
