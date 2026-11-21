import { prisma } from "../../db";
import { localDay as localDayAt } from "../../shared/time/instant";
import { startOfDayAt } from "../../shared/time/legacyValues";
import { zoneOf } from "../../shared/time/zoneOf";
import type { LinkLocation } from "./matcher";

/**
 * The entry types that carry automatically linked photos, and for each one the
 * {@link EntryPlan}: WHEN it happened (one or more windows) and WHERE (points or
 * a corridor per window). `matcher.ts` holds the rules; this file only knows the
 * shape of a flight, a stay, a journey, a rental, a cruise stop and a roadtrip
 * station. Every plan is own-account only: the entry is looked up by `userId`.
 *
 * A plan abstains (`"untimed"`) when the entry has no trustworthy time or no
 * position — a stay known to the month, a journey with day precision only — rather
 * than matching "some time that week".
 */

export const ENTRY_KINDS = [
  "flight",
  "stay",
  "rail",
  "bus",
  "ferry",
  "rental",
  "cruiseStop",
  "roadtripStop",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const isEntryKind = (value: string): value is EntryKind =>
  (ENTRY_KINDS as readonly string[]).includes(value);

/** The `EntryPhotoLink` foreign key that holds each kind. */
export const ENTRY_FK = {
  flight: "flightId",
  stay: "lodgingStayId",
  rail: "railJourneyId",
  bus: "busJourneyId",
  ferry: "ferryJourneyId",
  rental: "rentalId",
  cruiseStop: "cruiseStopId",
  roadtripStop: "tripStopId",
} as const satisfies Record<EntryKind, string>;
export type EntryFk = (typeof ENTRY_FK)[EntryKind];

export interface PlanLeg {
  window: { start: Date; end: Date };
  locations: LinkLocation[];
}
export type EntryPlan = { legs: PlanLeg[] } | "untimed";

const HOUR_MS = 3_600_000;
/** An airport: terminals, car parks and the viewing deck. */
export const AIRPORT_RADIUS_KM = 5;
/** Before take-off and after landing a traveller is still at the airport. */
export const AIRPORT_MARGIN_MS = 2 * HOUR_MS;
/** A hotel and its surroundings. */
export const STAY_RADIUS_KM = 1.5;
/** Either side of a rail line, which is not the straight line between the stations. */
export const RAIL_CORRIDOR_KM = 25;
export const BUS_CORRIDOR_KM = 15;
export const FERRY_CORRIDOR_KM = 10;
/** A car rental roams; a wide corridor between the stations, time still bounds it. */
export const RENTAL_CORRIDOR_KM = 40;
/** A cruise port and its town. */
export const PORT_RADIUS_KM = 12;
/** A roadtrip station. */
export const STATION_RADIUS_KM = 3;

/** Local-day window; the UTC day widened by the zones' reach when no zone is known. */
function dayWindowOf(day: string, tz: string | null): { start: Date; end: Date } {
  if (tz) {
    const start = startOfDayAt(day, tz);
    // The next local midnight, not +24 h: a day with a clock change is 23 or 25 hours long.
    const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 24 * HOUR_MS)
      .toISOString()
      .slice(0, 10);
    return { start, end: new Date(startOfDayAt(next, tz).getTime() - 1) };
  }
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  return {
    start: new Date(utcMidnight - 14 * HOUR_MS),
    end: new Date(utcMidnight + 36 * HOUR_MS - 1),
  };
}

/** The window of local days `firstDay`..`lastDay`. */
function daysWindow(firstDay: string, lastDay: string, tz: string | null) {
  return {
    start: dayWindowOf(firstDay, tz).start,
    end: dayWindowOf(lastDay < firstDay ? firstDay : lastDay, tz).end,
  };
}

const knownPrecision = (p: string | null): boolean => p !== "unknown" && p !== "day";

type Journey = {
  departureTime: Date;
  arrivalTime: Date | null;
  actualDepartureTime: Date | null;
  actualArrivalTime: Date | null;
  depPrecision: string | null;
  arrPrecision: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
};

/** Rail, bus and ferry share one shape: depart → arrive along a corridor. */
function journeyPlan(j: Journey, radiusKm: number): EntryPlan {
  const start = j.actualDepartureTime ?? j.departureTime;
  const end = j.actualArrivalTime ?? j.arrivalTime;
  if (end === null || !knownPrecision(j.depPrecision) || !knownPrecision(j.arrPrecision)) {
    return "untimed";
  }
  if (end.getTime() < start.getTime()) return "untimed";
  return {
    legs: [
      {
        window: { start, end },
        locations: [
          {
            kind: "corridor",
            from: { lat: j.depLat, lon: j.depLon },
            to: { lat: j.arrLat, lon: j.arrLon },
            radiusKm,
          },
        ],
      },
    ],
  };
}

const JOURNEY_SELECT = {
  departureTime: true,
  arrivalTime: true,
  actualDepartureTime: true,
  actualArrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
} as const;

/** Null when the entry is not the caller's. */
export async function planFor(
  userId: string,
  kind: EntryKind,
  id: string
): Promise<EntryPlan | null> {
  switch (kind) {
    case "flight": {
      const f = await prisma.flight.findFirst({
        where: { id, userId },
        select: {
          departureTime: true,
          arrivalTime: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
        },
      });
      if (!f) return null;
      const legs: PlanLeg[] = [];
      if (f.departureTime) {
        legs.push({
          window: {
            start: new Date(f.departureTime.getTime() - AIRPORT_MARGIN_MS),
            end: f.departureTime,
          },
          locations: [{ kind: "point", lat: f.depLat, lon: f.depLon, radiusKm: AIRPORT_RADIUS_KM }],
        });
      }
      if (f.arrivalTime) {
        legs.push({
          window: {
            start: f.arrivalTime,
            end: new Date(f.arrivalTime.getTime() + AIRPORT_MARGIN_MS),
          },
          locations: [{ kind: "point", lat: f.arrLat, lon: f.arrLon, radiusKm: AIRPORT_RADIUS_KM }],
        });
      }
      return legs.length > 0 ? { legs } : "untimed";
    }
    case "stay": {
      const s = await prisma.lodgingStay.findFirst({
        where: { id, userId },
        select: {
          checkInAt: true,
          checkOutAt: true,
          checkInDate: true,
          checkOutDate: true,
          stayZone: true,
          datePrecision: true,
          lodging: { select: { lat: true, lon: true } },
        },
      });
      if (!s) return null;
      const { lat, lon } = s.lodging;
      if (lat === null || lon === null || s.datePrecision !== "DAY") return "untimed";
      const tz = s.stayZone ?? zoneOf({ lat, lon });
      const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
      // Instants when both ends carry a time; else the local days.
      let window: { start: Date; end: Date } | null = null;
      if (s.checkInAt && s.checkOutAt) window = { start: s.checkInAt, end: s.checkOutAt };
      else if (day(s.checkInDate) && day(s.checkOutDate)) {
        window = daysWindow(day(s.checkInDate)!, day(s.checkOutDate)!, tz);
      }
      if (!window || window.end.getTime() < window.start.getTime()) return "untimed";
      return {
        legs: [{ window, locations: [{ kind: "point", lat, lon, radiusKm: STAY_RADIUS_KM }] }],
      };
    }
    case "rail": {
      const j = await prisma.railJourney.findFirst({
        where: { id, userId },
        select: JOURNEY_SELECT,
      });
      return j ? journeyPlan(j, RAIL_CORRIDOR_KM) : null;
    }
    case "bus": {
      const j = await prisma.busJourney.findFirst({
        where: { id, userId },
        select: JOURNEY_SELECT,
      });
      return j ? journeyPlan(j, BUS_CORRIDOR_KM) : null;
    }
    case "ferry": {
      const j = await prisma.ferryJourney.findFirst({
        where: { id, userId },
        select: JOURNEY_SELECT,
      });
      return j ? journeyPlan(j, FERRY_CORRIDOR_KM) : null;
    }
    case "rental": {
      const r = await prisma.rentalBooking.findFirst({
        where: { id, userId },
        select: {
          pickupTime: true,
          returnTime: true,
          actualPickupTime: true,
          actualReturnTime: true,
          pickupPrecision: true,
          returnPrecision: true,
          pickupLat: true,
          pickupLon: true,
          returnLat: true,
          returnLon: true,
        },
      });
      if (!r) return null;
      if (!knownPrecision(r.pickupPrecision) || !knownPrecision(r.returnPrecision)) {
        return "untimed";
      }
      const start = r.actualPickupTime ?? r.pickupTime;
      const end = r.actualReturnTime ?? r.returnTime;
      if (end.getTime() < start.getTime()) return "untimed";
      return {
        legs: [
          {
            window: { start, end },
            locations: [
              {
                kind: "corridor",
                from: { lat: r.pickupLat, lon: r.pickupLon },
                to: { lat: r.returnLat, lon: r.returnLon },
                radiusKm: RENTAL_CORRIDOR_KM,
              },
            ],
          },
        ],
      };
    }
    case "cruiseStop": {
      const c = await prisma.cruiseStop.findFirst({
        where: { id, cruise: { userId } },
        select: {
          isAtSea: true,
          stopDate: true,
          arrivalUtc: true,
          stopZone: true,
          port: { select: { lat: true, lon: true, timezone: true } },
        },
      });
      if (!c) return null;
      // A sea day or an unresolved port has no position: nothing to match against.
      if (c.isAtSea || !c.port || !c.stopDate) return "untimed";
      const tz = c.stopZone ?? c.port.timezone ?? zoneOf({ lat: c.port.lat, lon: c.port.lon });
      const dayStr = c.stopDate.toISOString().slice(0, 10);
      return {
        legs: [
          {
            window: dayWindowOf(dayStr, tz),
            locations: [
              { kind: "point", lat: c.port.lat, lon: c.port.lon, radiusKm: PORT_RADIUS_KM },
            ],
          },
        ],
      };
    }
    case "roadtripStop": {
      const t = await prisma.tripStop.findFirst({
        where: { id, route: { userId, kind: "roadtrip" } },
        select: {
          lat: true,
          lon: true,
          startUtc: true,
          endUtc: true,
          startDate: true,
          endDate: true,
          stopZone: true,
        },
      });
      if (!t) return null;
      if (t.lat === null || t.lon === null) return "untimed";
      const tz = t.stopZone ?? zoneOf({ lat: t.lat, lon: t.lon });
      const dayOf = (utc: Date | null, legacy: Date | null): string | null =>
        utc && tz ? localDayAt(utc, tz) : legacy ? legacy.toISOString().slice(0, 10) : null;
      const first = dayOf(t.startUtc, t.startDate);
      if (!first) return "untimed";
      const last = dayOf(t.endUtc, t.endDate) ?? first;
      return {
        legs: [
          {
            window: daysWindow(first, last, tz),
            locations: [{ kind: "point", lat: t.lat, lon: t.lon, radiusKm: STATION_RADIUS_KM }],
          },
        ],
      };
    }
  }
}

/** Every entry of the account of one kind that could carry photos, oldest first. */
export async function entryIdsOf(userId: string, kind: EntryKind): Promise<string[]> {
  const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((r) => r.id);
  switch (kind) {
    case "flight":
      return ids(
        prisma.flight.findMany({
          where: { userId },
          select: { id: true },
          orderBy: { departureTime: "asc" },
        })
      );
    case "stay":
      return ids(
        prisma.lodgingStay.findMany({
          where: { userId },
          select: { id: true },
          orderBy: { checkInDate: "asc" },
        })
      );
    case "rail":
      return ids(
        prisma.railJourney.findMany({
          where: { userId },
          select: { id: true },
          orderBy: { departureTime: "asc" },
        })
      );
    case "bus":
      return ids(
        prisma.busJourney.findMany({
          where: { userId },
          select: { id: true },
          orderBy: { departureTime: "asc" },
        })
      );
    case "ferry":
      return ids(
        prisma.ferryJourney.findMany({
          where: { userId },
          select: { id: true },
          orderBy: { departureTime: "asc" },
        })
      );
    case "rental":
      return ids(
        prisma.rentalBooking.findMany({
          where: { userId },
          select: { id: true },
          orderBy: { pickupTime: "asc" },
        })
      );
    case "cruiseStop":
      return ids(
        prisma.cruiseStop.findMany({
          where: { cruise: { userId }, isAtSea: false, stopDate: { not: null } },
          select: { id: true },
          orderBy: { stopDate: "asc" },
        })
      );
    case "roadtripStop":
      return ids(
        prisma.tripStop.findMany({
          where: { route: { userId, kind: "roadtrip" }, lat: { not: null }, viaPoint: false },
          select: { id: true },
          orderBy: { startDate: "asc" },
        })
      );
  }
}
