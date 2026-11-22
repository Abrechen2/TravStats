import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { getCachedAirports } from "../airportCache";
import { flightDepartureDay } from "../search/searchers";
import { dayAt, dbDay, joinParts } from "../search/types";
import { focusOf } from "./geometry";
import { DOMAIN_RANK, afterCursor, type FeedCursor, type FeedItem } from "./types";

/**
 * One reader per domain. Each takes the rows AFTER the cursor, newest first,
 * `take` of them — the bound goes into the query, not into a slice after a
 * full scan — and answers items already in that order. The merge across
 * domains is `feed.ts`'s; the readers never see each other.
 */
export type FeedSource = (
  userId: string,
  cursor: FeedCursor | null,
  take: number
) => Promise<FeedItem[]>;

const NOT_CANCELLED = { status: { not: "cancelled" } } as const;

export const arrow = (a: string | null | undefined, b: string | null | undefined): string | null =>
  a && b ? `${a} → ${b}` : (a ?? b ?? null);

/** Dated rows first, newest first; undated last; the id keeps it total. */
export const NEWEST_FIRST = (field: string, nullable: boolean) => [
  { [field]: nullable ? { sort: "desc", nulls: "last" } : "desc" },
  { id: "desc" },
];

export function isPlanned(sortAt: Date | null, now: Date): boolean {
  return sortAt !== null && sortAt.getTime() > now.getTime();
}

export const flightSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      ...NOT_CANCELLED,
      ...(afterCursor(
        "departureTime",
        DOMAIN_RANK.flight,
        cursor,
        true
      ) as Prisma.FlightWhereInput),
    },
    orderBy: NEWEST_FIRST("departureTime", true) as Prisma.FlightOrderByWithRelationInput[],
    take,
    select: {
      id: true,
      airline: true,
      airlineIata: true,
      flightNumber: true,
      depIata: true,
      depIcao: true,
      depName: true,
      depLat: true,
      depLon: true,
      depTimezone: true,
      arrIata: true,
      arrIcao: true,
      arrName: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
      arrTimezone: true,
      depPrecision: true,
      arrPrecision: true,
      actualDeparture: true,
      actualArrival: true,
      runwayDepartureTime: true,
      runwayArrivalTime: true,
      onlineCheckInOpensAt: true,
      onlineCheckInZone: true,
    },
  });
  const codes = rows.flatMap((f) => [f.depIata ?? f.depIcao, f.arrIata ?? f.arrIcao]);
  const known = [...new Set(codes.filter((c): c is string => !!c))];
  const airports = known.length ? await getCachedAirports(known) : new Map();
  const now = new Date();
  const days = await Promise.all(rows.map((f) => flightDepartureDay(f)));
  return rows.map((f, i) => {
    const dep = airports.get((f.depIata ?? f.depIcao ?? "").toUpperCase());
    const arr = airports.get((f.arrIata ?? f.arrIcao ?? "").toUpperCase());
    // The airport catalogue first: the row's own coordinates are 0/0 when never resolved.
    const focus = focusOf([
      { lat: dep?.lat ?? f.depLat, lon: dep?.lon ?? f.depLon },
      { lat: arr?.lat ?? f.arrLat, lon: arr?.lon ?? f.arrLon },
    ]);
    const route = arrow(f.depIata ?? f.depIcao, f.arrIata ?? f.arrIcao);
    const number = f.flightNumber
      ? f.flightNumber.startsWith(f.airlineIata ?? "\0")
        ? f.flightNumber
        : joinParts([f.airlineIata, f.flightNumber], " ")
      : null;
    return {
      key: `flight:${f.id}`,
      domain: "flight",
      id: f.id,
      subjectId: f.id,
      title: route ?? number ?? "—",
      subtitle: joinParts([number, f.airline]),
      place: arrow(dep?.city ?? f.depName, arr?.city ?? f.arrName),
      date: days[i],
      sortAt: f.departureTime?.toISOString() ?? null,
      planned: isPlanned(f.departureTime, now),
      ...focus,
      path: `/flights/${f.id}`,
    } satisfies FeedItem;
  });
};

export const cruiseSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.cruise.findMany({
    where: {
      userId,
      ...NOT_CANCELLED,
      ...(afterCursor("startDate", DOMAIN_RANK.cruise, cursor, true) as Prisma.CruiseWhereInput),
    },
    orderBy: NEWEST_FIRST("startDate", true) as Prisma.CruiseOrderByWithRelationInput[],
    take,
    select: {
      id: true,
      shipNameOverride: true,
      cruiseLine: true,
      routeName: true,
      startDate: true,
      startDay: true,
      startZone: true,
      ship: { select: { name: true } },
      departurePort: { select: { name: true, lat: true, lon: true } },
      arrivalPort: { select: { name: true, lat: true, lon: true } },
      stops: { select: { port: { select: { lat: true, lon: true } } } },
    },
  });
  const now = new Date();
  return rows.map((c) => {
    const focus = focusOf([
      c.departurePort ?? { lat: null, lon: null },
      c.arrivalPort ?? { lat: null, lon: null },
      ...c.stops.map((s) => s.port ?? { lat: null, lon: null }),
    ]);
    return {
      key: `cruise:${c.id}`,
      domain: "cruise",
      id: c.id,
      subjectId: c.id,
      title: c.shipNameOverride ?? c.ship?.name ?? c.routeName ?? c.cruiseLine ?? "—",
      subtitle: c.cruiseLine,
      place: arrow(c.departurePort?.name, c.arrivalPort?.name),
      date: c.startDay ? dbDay(c.startDay, c.startZone) : dayAt(c.startDate, c.startZone),
      sortAt: c.startDate?.toISOString() ?? null,
      planned: isPlanned(c.startDate, now),
      ...focus,
      path: `/cruises/${c.id}`,
    } satisfies FeedItem;
  });
};

/** One row per STAY — a hotel visited three times is three entries of the logbook. */
export const lodgingSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.lodgingStay.findMany({
    where: {
      userId,
      ...NOT_CANCELLED,
      ...(afterCursor(
        "checkIn",
        DOMAIN_RANK.lodging,
        cursor,
        true
      ) as Prisma.LodgingStayWhereInput),
    },
    orderBy: NEWEST_FIRST("checkIn", true) as Prisma.LodgingStayOrderByWithRelationInput[],
    take,
    select: {
      id: true,
      lodgingId: true,
      checkIn: true,
      checkInDate: true,
      stayZone: true,
      datePrecision: true,
      lodging: { select: { name: true, city: true, country: true, lat: true, lon: true } },
    },
  });
  const now = new Date();
  return rows.map((s) => {
    const precision =
      s.datePrecision === "MONTH" ? "month" : s.datePrecision === "YEAR" ? "year" : "day";
    const undated = s.datePrecision === "NONE";
    return {
      key: `lodging:${s.id}`,
      domain: "lodging",
      id: s.id,
      subjectId: s.lodgingId,
      title: s.lodging.name,
      subtitle: null,
      place: joinParts([s.lodging.city, s.lodging.country]),
      date: undated
        ? null
        : s.checkInDate
          ? { ...dbDay(s.checkInDate, s.stayZone)!, precision }
          : dayAt(s.checkIn, s.stayZone, precision),
      sortAt: s.checkIn?.toISOString() ?? null,
      planned: isPlanned(s.checkIn, now),
      ...focusOf([s.lodging]),
      path: `/lodging/${s.lodgingId}`,
    } satisfies FeedItem;
  });
};

/** One row per VISIT. A wishlist place with no visit is a plan, not an activity, and has none. */
export const placeSource: FeedSource = async (userId, cursor, take) => {
  const rows = await prisma.placeVisit.findMany({
    where: {
      userId,
      ...(afterCursor("visitedAt", DOMAIN_RANK.poi, cursor, true) as Prisma.PlaceVisitWhereInput),
    },
    orderBy: NEWEST_FIRST("visitedAt", true) as Prisma.PlaceVisitOrderByWithRelationInput[],
    take,
    select: {
      id: true,
      placeId: true,
      visitedAt: true,
      visitedAtUtc: true,
      visitedZone: true,
      visitedPrecision: true,
      place: { select: { name: true, city: true, country: true, lat: true, lon: true } },
    },
  });
  const now = new Date();
  return rows.map((v) => {
    const precision =
      v.visitedPrecision === "month" || v.visitedPrecision === "year" ? v.visitedPrecision : "day";
    return {
      key: `poi:${v.id}`,
      domain: "poi",
      id: v.id,
      subjectId: v.placeId,
      title: v.place.name,
      subtitle: null,
      place: joinParts([v.place.city, v.place.country]),
      date: v.visitedAtUtc
        ? dayAt(v.visitedAtUtc, v.visitedZone, precision)
        : dayAt(v.visitedAt, null, precision),
      // The ORDER column itself (`visitedAt`), so the cursor reads back what the query sorted on.
      sortAt: v.visitedAt?.toISOString() ?? null,
      planned: isPlanned(v.visitedAt, now),
      ...focusOf([v.place]),
      path: `/places/${v.placeId}`,
    } satisfies FeedItem;
  });
};
