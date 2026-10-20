import { prisma } from "../../db";
import type { ItineraryItem, ItineraryView } from "../../schemas/shareLinkItinerary";
import { now } from "../../shared/time/clock";
import { cruiseStopTimes, cruiseTimes } from "../cruise/timesDto";
import { enrichFlightsForClients } from "../flightAirportFacts";
import { stayTimes } from "../lodging/timesDto";
import { visitTime } from "../places/timesDto";
import { railTimes } from "../rail/timesDto";
import { rentalTimes } from "../rental/timesDto";
import { tripStopTimes } from "../trips/timesDto";
import { FLIGHT_VIEW_SELECT, flightProgress } from "./flightView";
import { nowMarker, sortItinerary } from "./itineraryNow";

/**
 * The `itinerary` of a trip link (forgejo#302): where the traveller is when,
 * with flight numbers and hotel names, so family can follow the trip.
 *
 * Built ENTRY BY ENTRY from named columns, like the flight view: every select
 * below lists what the item may carry plus the columns the domain's `times`
 * builder reads, and nothing else — a booking reference, seat, room or cabin
 * number, price, document, note or companion is never even loaded, and an id
 * loaded for a join never leaves this file. Times go through each domain's own
 * `times` builder, so the plan shows exactly what the entry's page shows, on
 * the place's clock and at the precision stored (ADR 0002).
 *
 * Re-read on every request: an entry changed, added or cancelled shows on the
 * next load of the page.
 */

/** A cancelled entry never happens; a flight marked as a duplicate is the same flight twice. */
const NOT_CANCELLED = { status: { not: "cancelled" } } as const;
const flightOnPlan = () => ({ status: { notIn: ["cancelled", "duplicated"] } });

const RIDE_TIME_SELECT = {
  departureTime: true,
  arrivalTime: true,
  actualDepartureTime: true,
  actualArrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  depStationName: true,
  arrStationName: true,
  operator: true,
} as const;

const joinService = (...parts: Array<string | null>): string | null =>
  parts.filter((p) => p && p.trim()).join(" ") || null;

async function flightItems(tripId: string): Promise<ItineraryItem[]> {
  const rows = await prisma.flight.findMany({
    where: { tripId, ...flightOnPlan() },
    select: FLIGHT_VIEW_SELECT,
  });
  const at = now();
  return (await enrichFlightsForClients(rows)).map((f) => ({
    kind: "flight",
    airline: f.airline,
    flightNumber: f.flightNumber,
    from: { code: f.depIata ?? f.depIcao, name: f.depName },
    to: { code: f.arrIata ?? f.arrIcao, name: f.arrName },
    departure: f.times.departure,
    arrival: f.times.arrival,
    phase: flightProgress(f.status, f.times, at).phase,
  }));
}

async function stayItems(tripId: string): Promise<ItineraryItem[]> {
  const rows = await prisma.lodgingStay.findMany({
    where: { tripId, ...NOT_CANCELLED },
    select: {
      checkIn: true,
      checkOut: true,
      checkInDate: true,
      checkOutDate: true,
      checkInAt: true,
      checkOutAt: true,
      stayZone: true,
      datePrecision: true,
      // Read only because `stayTimes` builds the deadlines too; never shown.
      freeCancellationUntil: true,
      freeCancellationOn: true,
      freeCancellationZone: true,
      paymentDueOn: true,
      lodging: { select: { name: true, address: true, city: true, country: true } },
    },
  });
  return rows.map((s) => {
    const times = stayTimes(s);
    return {
      kind: "stay",
      name: s.lodging.name,
      address: s.lodging.address,
      city: s.lodging.city,
      country: s.lodging.country,
      checkIn: times.checkIn,
      checkOut: times.checkOut,
      checkInAt: times.checkInAt,
      checkOutAt: times.checkOutAt,
    };
  });
}

async function cruiseItems(tripId: string): Promise<ItineraryItem[]> {
  const rows = await prisma.cruise.findMany({
    where: { tripId, ...NOT_CANCELLED },
    select: {
      shipNameOverride: true,
      cruiseLine: true,
      startDate: true,
      endDate: true,
      startDay: true,
      endDay: true,
      startZone: true,
      endZone: true,
      ship: { select: { name: true } },
      stops: {
        orderBy: { dayNumber: "asc" },
        select: {
          dayNumber: true,
          isAtSea: true,
          unresolvedPortName: true,
          date: true,
          stopDate: true,
          stopZone: true,
          arrivalTime: true,
          departureTime: true,
          arrivalUtc: true,
          departureUtc: true,
          timePrecision: true,
          port: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((c) => {
    const times = cruiseTimes(c);
    return {
      kind: "cruise",
      ship: c.shipNameOverride ?? c.ship?.name ?? null,
      cruiseLine: c.cruiseLine,
      start: times.start,
      end: times.end,
      ports: c.stops.map((s) => {
        const stop = cruiseStopTimes(s);
        return {
          dayNumber: s.dayNumber,
          name: s.isAtSea ? null : (s.port?.name ?? s.unresolvedPortName),
          atSea: s.isAtSea,
          day: stop.date,
          arrival: stop.arrival,
          departure: stop.departure,
        };
      }),
    };
  });
}

async function rideItems(tripId: string): Promise<ItineraryItem[]> {
  const where = { tripId, ...NOT_CANCELLED };
  const [rail, bus, ferry] = await Promise.all([
    prisma.railJourney.findMany({
      where,
      select: { ...RIDE_TIME_SELECT, trainCategory: true, trainNumber: true },
    }),
    prisma.busJourney.findMany({ where, select: { ...RIDE_TIME_SELECT, lineName: true } }),
    prisma.ferryJourney.findMany({ where, select: { ...RIDE_TIME_SELECT, vesselName: true } }),
  ]);
  const ride = <K extends "rail" | "bus" | "ferry">(
    kind: K,
    r: (typeof rail)[number] | (typeof bus)[number] | (typeof ferry)[number],
    service: string | null
  ) => {
    // Bus and ferry rides carry rail's columns and use rail's reader (their own timesDto).
    const times = railTimes(r);
    return {
      kind,
      operator: r.operator,
      service,
      from: r.depStationName,
      to: r.arrStationName,
      departure: times.departure,
      arrival: times.arrival,
    };
  };
  return [
    ...rail.map((r) => ride("rail", r, joinService(r.trainCategory, r.trainNumber))),
    ...bus.map((r) => ride("bus", r, joinService(r.lineName))),
    ...ferry.map((r) => ride("ferry", r, joinService(r.vesselName))),
  ];
}

async function rentalItems(tripId: string): Promise<ItineraryItem[]> {
  const rows = await prisma.rentalBooking.findMany({
    where: { tripId, ...NOT_CANCELLED },
    select: {
      provider: true,
      pickupStationName: true,
      returnStationName: true,
      pickupTime: true,
      returnTime: true,
      actualPickupTime: true,
      actualReturnTime: true,
      pickupTimezone: true,
      returnTimezone: true,
      pickupPrecision: true,
      returnPrecision: true,
      actualPickupPrecision: true,
      actualReturnPrecision: true,
      // Read only because `rentalTimes` builds the deadlines too; never shown.
      freeCancellationUntil: true,
      freeCancellationOn: true,
      freeCancellationZone: true,
      paymentDueOn: true,
    },
  });
  return rows.map((r) => {
    const times = rentalTimes(r);
    return {
      kind: "rental",
      provider: r.provider,
      pickup: { station: r.pickupStationName, at: times.pickup },
      return: { station: r.returnStationName, at: times.return },
    };
  });
}

async function visitItems(tripId: string): Promise<ItineraryItem[]> {
  const rows = await prisma.placeVisit.findMany({
    where: { tripId },
    orderBy: { orderIdx: "asc" },
    select: {
      visitedAt: true,
      visitedAtUtc: true,
      visitedZone: true,
      visitedPrecision: true,
      place: { select: { name: true, city: true } },
    },
  });
  return rows.map((v) => ({
    kind: "visit",
    name: v.place.name,
    city: v.place.city,
    at: visitTime(v),
  }));
}

/**
 * The trip's own timeline stops — only those that stand for themselves. A stop
 * wrapping another entry (`sourceId`) or a stay (`lodgingStayId`) would list
 * that entry twice, and a route correction (`viaPoint`) is no place anyone is.
 */
async function stopItems(tripId: string): Promise<ItineraryItem[]> {
  const rows = await prisma.tripStop.findMany({
    where: { tripId, sourceId: null, lodgingStayId: null, viaPoint: false },
    orderBy: { orderIdx: "asc" },
    select: {
      title: true,
      startDate: true,
      endDate: true,
      startUtc: true,
      endUtc: true,
      stopZone: true,
      precision: true,
    },
  });
  return rows.map((s) => {
    const times = tripStopTimes(s);
    return { kind: "stop", name: s.title, start: times.start, end: times.end };
  });
}

export async function buildItinerary(tripId: string): Promise<ItineraryView> {
  const groups = await Promise.all([
    flightItems(tripId),
    stayItems(tripId),
    cruiseItems(tripId),
    rideItems(tripId),
    rentalItems(tripId),
    visitItems(tripId),
    stopItems(tripId),
  ]);
  const items = sortItinerary(groups.flat());
  return { items, now: nowMarker(items, now()) };
}
