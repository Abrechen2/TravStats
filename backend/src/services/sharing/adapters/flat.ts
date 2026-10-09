import type { Flight, Prisma, RailJourney, RentalBooking } from "../../../prisma";
import { SHARED_SOURCE } from "../copyEntries";
import {
  FLIGHT_FACT_FIELDS,
  RAIL_FACT_FIELDS,
  RENTAL_FACT_FIELDS,
  flightFacts,
  pickFacts,
  railFacts,
  rentalFacts,
  type FlightFactField,
  type RailFactField,
  type RentalFactField,
} from "../facts";
import { joinLabel, plainData, type EntityAdapter, type SharedRow } from "./types";

/**
 * The three types whose facts are their own columns and nothing else:
 * flights, rail journeys and rentals.
 */

const FLIGHT_JSON = ["actualRoute", "specialData"] as const;
const RAIL_JSON = ["geometry"] as const;

function flightRow(row: Flight): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: pickFacts(row, FLIGHT_FACT_FIELDS),
    label: joinLabel(
      row.flightNumber ?? row.airline,
      `${row.depIata ?? row.depIcao ?? "?"} → ${row.arrIata ?? row.arrIcao ?? "?"}`
    ),
    zones: {
      departureTime: row.depTimezone,
      actualDeparture: row.depTimezone,
      runwayDepartureTime: row.depTimezone,
      arrivalTime: row.arrTimezone,
      actualArrival: row.arrTimezone,
      runwayArrivalTime: row.arrTimezone,
    },
  };
}

export const flightAdapter: EntityAdapter = {
  entity: "flight",
  fields: FLIGHT_FACT_FIELDS,
  async load(c, ids) {
    return (await c.flight.findMany({ where: { id: { in: [...ids] } } })).map(flightRow);
  },
  async copiesOf(c, shareKey, groupId) {
    return (await c.flight.findMany({ where: { shareKey, trip: { shareGroupId: groupId } } })).map(
      flightRow
    );
  },
  async setKey(c, id, key) {
    await c.flight.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.flight.create({
      data: {
        ...flightFacts(source.facts as Pick<Flight, FlightFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
        dataSource: SHARED_SOURCE,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, FLIGHT_FACT_FIELDS, FLIGHT_JSON);
    await c.flight.update({
      where: { id: copy.id },
      data: data as Prisma.FlightUncheckedUpdateInput,
    });
  },
  async remove(c, id) {
    await c.flight.delete({ where: { id } });
  },
};

function railRow(row: RailJourney): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: pickFacts(row, RAIL_FACT_FIELDS),
    label: joinLabel(
      row.trainCategory,
      row.trainNumber,
      `${row.depStationName} → ${row.arrStationName}`
    ),
    zones: {
      departureTime: row.depTimezone,
      actualDepartureTime: row.depTimezone,
      arrivalTime: row.arrTimezone,
      actualArrivalTime: row.arrTimezone,
    },
  };
}

export const railAdapter: EntityAdapter = {
  entity: "rail",
  fields: RAIL_FACT_FIELDS,
  async load(c, ids) {
    return (await c.railJourney.findMany({ where: { id: { in: [...ids] } } })).map(railRow);
  },
  async copiesOf(c, shareKey, groupId) {
    return (
      await c.railJourney.findMany({ where: { shareKey, trip: { shareGroupId: groupId } } })
    ).map(railRow);
  },
  async setKey(c, id, key) {
    await c.railJourney.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.railJourney.create({
      data: {
        ...railFacts(source.facts as Pick<RailJourney, RailFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, RAIL_FACT_FIELDS, RAIL_JSON);
    await c.railJourney.update({
      where: { id: copy.id },
      data: data as Prisma.RailJourneyUncheckedUpdateInput,
    });
  },
  async remove(c, id) {
    await c.railJourney.delete({ where: { id } });
  },
};

function rentalRow(row: RentalBooking): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: pickFacts(row, RENTAL_FACT_FIELDS),
    label: joinLabel(row.provider, row.pickupStationName),
    zones: {
      pickupTime: row.pickupTimezone,
      actualPickupTime: row.pickupTimezone,
      returnTime: row.returnTimezone,
      actualReturnTime: row.returnTimezone,
    },
  };
}

export const rentalAdapter: EntityAdapter = {
  entity: "rental",
  fields: RENTAL_FACT_FIELDS,
  async load(c, ids) {
    return (await c.rentalBooking.findMany({ where: { id: { in: [...ids] } } })).map(rentalRow);
  },
  async copiesOf(c, shareKey, groupId) {
    return (
      await c.rentalBooking.findMany({ where: { shareKey, trip: { shareGroupId: groupId } } })
    ).map(rentalRow);
  },
  async setKey(c, id, key) {
    await c.rentalBooking.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.rentalBooking.create({
      data: {
        ...rentalFacts(source.facts as Pick<RentalBooking, RentalFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, RENTAL_FACT_FIELDS);
    await c.rentalBooking.update({
      where: { id: copy.id },
      data: data as Prisma.RentalBookingUncheckedUpdateInput,
    });
  },
  async remove(c, id) {
    await c.rentalBooking.delete({ where: { id } });
  },
};
