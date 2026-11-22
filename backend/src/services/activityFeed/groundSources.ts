import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { STATIONS_ONLY } from "../roadtrip/roadtripSummary";
import { dayAt, dbDay, joinParts } from "../search/types";
import { focusOf } from "./geometry";
import { arrow, isPlanned, NEWEST_FIRST, type FeedSource } from "./sources";
import { DOMAIN_RANK, afterCursor, isAfterCursor, type FeedItem } from "./types";

/** Rail, bus, ferry and rental rows, and the two route kinds (tours, roadtrips). */

type RideDomain = "rail" | "bus" | "ferry";

interface RideRow {
  id: string;
  label: string | null;
  depStationName: string;
  arrStationName: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  departureTime: Date;
  depTimezone: string | null;
  depPrecision: string | null;
}

function rideItem(domain: RideDomain, r: RideRow, now: Date): FeedItem {
  const route = arrow(r.depStationName, r.arrStationName);
  const precision =
    r.depPrecision === "month" || r.depPrecision === "year" ? r.depPrecision : "day";
  return {
    key: `${domain}:${r.id}`,
    domain,
    id: r.id,
    subjectId: r.id,
    title: r.label ?? route ?? "—",
    subtitle: r.label ? route : null,
    place: route,
    date: dayAt(r.departureTime, r.depTimezone, precision),
    sortAt: r.departureTime.toISOString(),
    planned: isPlanned(r.departureTime, now),
    ...focusOf([
      { lat: r.depLat, lon: r.depLon },
      { lat: r.arrLat, lon: r.arrLon },
    ]),
    path: `/${domain}/${r.id}`,
  };
}

const RIDE_SELECT = {
  id: true,
  depStationName: true,
  arrStationName: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  departureTime: true,
  depTimezone: true,
  depPrecision: true,
} as const;

export const railSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.railJourney.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      ...(afterCursor(
        "departureTime",
        DOMAIN_RANK.rail,
        cursor,
        false
      ) as Prisma.RailJourneyWhereInput),
    },
    orderBy: NEWEST_FIRST("departureTime", false) as Prisma.RailJourneyOrderByWithRelationInput[],
    take,
    select: { ...RIDE_SELECT, trainCategory: true, trainNumber: true },
  });
  const now = new Date();
  return rows.map((r) =>
    rideItem("rail", { ...r, label: joinParts([r.trainCategory, r.trainNumber], " ") }, now)
  );
};

export const busSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.busJourney.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      ...(afterCursor(
        "departureTime",
        DOMAIN_RANK.bus,
        cursor,
        false
      ) as Prisma.BusJourneyWhereInput),
    },
    orderBy: NEWEST_FIRST("departureTime", false) as Prisma.BusJourneyOrderByWithRelationInput[],
    take,
    select: { ...RIDE_SELECT, lineName: true },
  });
  const now = new Date();
  return rows.map((r) => rideItem("bus", { ...r, label: r.lineName }, now));
};

export const ferrySource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.ferryJourney.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      ...(afterCursor(
        "departureTime",
        DOMAIN_RANK.ferry,
        cursor,
        false
      ) as Prisma.FerryJourneyWhereInput),
    },
    orderBy: NEWEST_FIRST("departureTime", false) as Prisma.FerryJourneyOrderByWithRelationInput[],
    take,
    select: { ...RIDE_SELECT, vesselName: true },
  });
  const now = new Date();
  return rows.map((r) => rideItem("ferry", { ...r, label: r.vesselName }, now));
};

export const rentalSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.rentalBooking.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      ...(afterCursor(
        "pickupTime",
        DOMAIN_RANK.rental,
        cursor,
        false
      ) as Prisma.RentalBookingWhereInput),
    },
    orderBy: NEWEST_FIRST("pickupTime", false) as Prisma.RentalBookingOrderByWithRelationInput[],
    take,
    select: {
      id: true,
      operatedBy: true,
      pickupStationName: true,
      returnStationName: true,
      vehicleExample: true,
      pickupLat: true,
      pickupLon: true,
      returnLat: true,
      returnLon: true,
      pickupTime: true,
      pickupTimezone: true,
    },
  });
  const now = new Date();
  return rows.map(
    (r) =>
      ({
        key: `rental:${r.id}`,
        domain: "rental",
        id: r.id,
        subjectId: r.id,
        title: r.operatedBy ?? r.pickupStationName,
        subtitle: r.vehicleExample,
        place:
          r.returnStationName !== r.pickupStationName
            ? arrow(r.pickupStationName, r.returnStationName)
            : r.pickupStationName,
        date: dayAt(r.pickupTime, r.pickupTimezone),
        sortAt: r.pickupTime.toISOString(),
        planned: isPlanned(r.pickupTime, now),
        ...focusOf([
          { lat: r.pickupLat, lon: r.pickupLon },
          { lat: r.returnLat, lon: r.returnLon },
        ]),
        path: `/rentals/${r.id}`,
      }) satisfies FeedItem
  );
};

/**
 * A day tour is dated by `tourDate` (a column, so the cursor goes into the
 * query); a roadtrip has no date of its own — its first station dates it, on
 * that station's clock — so roadtrips are read whole (an account holds tens of
 * them, each a few station rows) and cut by the cursor in memory.
 */
const ROUTE_STOPS = {
  where: STATIONS_ONLY,
  select: { lat: true, lon: true, startDate: true, startUtc: true, stopZone: true },
  orderBy: [{ startDate: "asc" as const }, { id: "asc" as const }],
};

export const tourSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.tripRoute.findMany({
    where: {
      userId,
      kind: "tour",
      ...(afterCursor("tourDate", DOMAIN_RANK.tour, cursor, true) as Prisma.TripRouteWhereInput),
    },
    orderBy: NEWEST_FIRST("tourDate", true) as Prisma.TripRouteOrderByWithRelationInput[],
    take,
    select: {
      id: true,
      name: true,
      tourDate: true,
      trip: { select: { name: true } },
      stops: ROUTE_STOPS,
    },
  });
  const now = new Date();
  return rows.map(
    (t) =>
      ({
        key: `tour:${t.id}`,
        domain: "tour",
        id: t.id,
        subjectId: t.id,
        title: t.name,
        subtitle: t.trip?.name ?? null,
        place: null,
        // A tour day names no place: the day is what is known.
        date: dbDay(t.tourDate, null),
        sortAt: t.tourDate?.toISOString() ?? null,
        planned: isPlanned(t.tourDate, now),
        ...focusOf(t.stops),
        path: `/tours/${t.id}`,
      }) satisfies FeedItem
  );
};

export const roadtripSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      id: true,
      name: true,
      vehicleName: true,
      trip: { select: { name: true } },
      stops: ROUTE_STOPS,
    },
  });
  const now = new Date();
  const items = rows.map((r) => {
    const first = r.stops[0];
    const at = first?.startUtc ?? first?.startDate ?? null;
    const item = {
      key: `roadtrip:${r.id}`,
      domain: "roadtrip",
      id: r.id,
      subjectId: r.id,
      title: r.name,
      subtitle: r.vehicleName ?? r.trip?.name ?? null,
      place: null,
      date: first?.startUtc
        ? dayAt(first.startUtc, first.stopZone)
        : dayAt(first?.startDate ?? null, null),
      sortAt: at?.toISOString() ?? null,
      planned: isPlanned(at, now),
      ...focusOf(r.stops),
      path: `/roadtrips/${r.id}`,
    } satisfies FeedItem;
    return item;
  });
  return items
    .filter((i) =>
      isAfterCursor(
        i.sortAt === null ? null : Date.parse(i.sortAt),
        DOMAIN_RANK.roadtrip,
        i.id,
        cursor
      )
    )
    .sort((a, b) => {
      if (a.sortAt === b.sortAt) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      if (a.sortAt === null) return 1;
      if (b.sortAt === null) return -1;
      return a.sortAt < b.sortAt ? 1 : -1;
    })
    .slice(0, take);
};
