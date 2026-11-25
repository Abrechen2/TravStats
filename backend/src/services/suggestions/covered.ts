import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { fromDbDate } from "../../shared/time/localDate";
import { meters } from "../dawarich/stays/detect";
import { isOwnEntry } from "../locationEvidence/acceptance";
import { visitDay } from "../places/visitTrip";

/**
 * "You already wrote this down" — one rule for every place-shaped suggestion
 * (forgejo#439): photo findings and GPS stays alike.
 *
 * Measured on prod 2026-11-24: 23 of 102 pending photo suggestions sat on a
 * place visit of the same day, the Freiburg one 331 m from "Rathaus
 * Verw.geb." on the very trip it named. The stay scan had its own rule (250 m,
 * a visit's clock within two hours) and the photo scan another (200 m), and
 * neither looked again once a finding was written.
 *
 * A suggestion is covered by
 *  - a place visit whose pin lies within a venue-sized radius
 *    (`VENUE_RADIUS_M`; `POINT_VENUE_RADIUS_M` for a restaurant, a shop or a
 *    service area, whose neighbour is not the same place) on one of the
 *    suggestion's local days — ±1 day when it ran overnight;
 *  - a lodging stay at that pin whose nights hold one of those days;
 *  - a flight leaving or reaching that pin (the airport) on one of those days;
 * and, when the suggestion names a trip, only by an entry on that trip or on
 * none. The nearest such entry is the one named.
 *
 * Pure apart from `loadCoverContext`. The reconcile (`reconcile.ts`) and the
 * scans' creation-time checks both call `judgeCover`, so a finding is never
 * offered by one rule and closed by another.
 */
export const VENUE_RADIUS_M = 400;
export const POINT_VENUE_RADIUS_M = 150;
/** A hotel is a building with grounds — the stay scan's measured radius. */
export const LODGING_RADIUS_M = 250;
/** An airport's reference point sits far from its terminals. */
export const AIRPORT_RADIUS_M = 1000;
/** Categories whose venue is a door, not a site (`shared/placeCategories.ts`). */
export const POINT_VENUE_CATEGORIES: ReadonlySet<string> = new Set([
  "restaurant",
  "shopping",
  "service_area",
]);
/** A suggestion that crosses a local midnight and lasts this long ran overnight. */
const OVERNIGHT_MIN_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

export interface CoverTarget {
  startAt: Date;
  endAt: Date;
  lat: number;
  lon: number;
  /** The suggestion's zone; null reads the UTC dates. */
  zone: string | null;
  /** The trip the suggestion names, if any. */
  tripId?: string | null;
  /** A finding's neutral key: a visit made by accepting it never covers it. */
  evidenceKey?: string | null;
}

export interface CoverVisit {
  id: string;
  tripId?: string | null;
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
  visitedZone: string | null;
  visitedPrecision: string | null;
  suggestionRef?: string | null;
  place: { id: string; name: string; lat: number; lon: number; category?: string | null };
}

export interface CoverLodgingStay {
  id: string;
  tripId?: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  lodging: { id: string; name: string; lat: number | null; lon: number | null };
}

export interface CoverFlight {
  id: string;
  tripId?: string | null;
  flightNumber: string | null;
  status: string;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depIata: string | null;
  depLat: number;
  depLon: number;
  arrIata: string | null;
  arrLat: number;
  arrLon: number;
}

export interface CoverPlace {
  id: string;
  name: string;
  localName?: string | null;
  lat: number;
  lon: number;
  category?: string | null;
}

export interface CoverContext {
  visits: readonly CoverVisit[];
  lodgingStays: readonly CoverLodgingStay[];
  flights?: readonly CoverFlight[];
  /** Only for "the place exists, the visit is missing" (`nearPlace`). */
  places?: readonly CoverPlace[];
}

export interface Covering {
  kind: "visit" | "lodging" | "flight";
  /** The place visit, the lodging stay or the flight. */
  id: string;
  placeId?: string;
  lodgingId?: string;
  name: string;
  distanceM: number;
  /** The local day the entry holds. */
  day: string;
}

export interface CoverVerdict {
  covered: Covering | null;
  /** Not covered, but an own place lies within reach: accepting should add a visit to it. */
  nearPlace: { id: string; name: string; localName: string | null; distanceM: number } | null;
}

export function radiusFor(category: string | null | undefined): number {
  return category && POINT_VENUE_CATEGORIES.has(category) ? POINT_VENUE_RADIUS_M : VENUE_RADIUS_M;
}

function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The suggestion's local days, widened by one on each side when it ran overnight. */
export function coverDays(t: Pick<CoverTarget, "startAt" | "endAt" | "zone">): Set<string> {
  const day = (d: Date) => (t.zone ? localDay(d, t.zone) : d.toISOString().slice(0, 10));
  const first = day(t.startAt);
  const last = day(t.endAt);
  const days = new Set<string>();
  for (let d = first; d <= last; d = shiftDay(d, 1)) days.add(d);
  const overnight = first !== last && t.endAt.getTime() - t.startAt.getTime() >= OVERNIGHT_MIN_MS;
  if (overnight) {
    days.add(shiftDay(first, -1));
    days.add(shiftDay(last, 1));
  }
  return days;
}

function lodgingDays(s: CoverLodgingStay): { first: string; last: string } | null {
  const first = s.checkInDate
    ? fromDbDate(s.checkInDate)
    : (s.checkIn?.toISOString().slice(0, 10) ?? null);
  const last = s.checkOutDate
    ? fromDbDate(s.checkOutDate)
    : (s.checkOut?.toISOString().slice(0, 10) ?? null);
  return first && last ? { first, last } : null;
}

/** An entry on another trip than the one the suggestion names does not cover it. */
const tripAllows = (target: CoverTarget, entryTripId: string | null | undefined): boolean =>
  !target.tripId || !entryTripId || entryTripId === target.tripId;

/** Whether, and by what, the logbook already holds this suggestion. Pure. */
export function judgeCover(target: CoverTarget, ctx: CoverContext): CoverVerdict {
  const days = coverDays(target);
  const dayOf = (d: Date) =>
    target.zone ? localDay(d, target.zone) : d.toISOString().slice(0, 10);
  let best: Covering | null = null;
  const consider = (c: Covering, radius: number) => {
    if (c.distanceM <= radius && (!best || c.distanceM < best.distanceM)) best = c;
  };

  for (const v of ctx.visits) {
    if (isOwnEntry(v, target.evidenceKey) || !tripAllows(target, v.tripId)) continue;
    const day = visitDay(v);
    if (day === null || !days.has(day)) continue;
    consider(
      {
        kind: "visit",
        id: v.id,
        placeId: v.place.id,
        name: v.place.name,
        distanceM: Math.round(meters(v.place, target)),
        day,
      },
      radiusFor(v.place.category)
    );
  }
  for (const s of ctx.lodgingStays) {
    const { lat, lon } = s.lodging;
    if (lat === null || lon === null || !tripAllows(target, s.tripId)) continue;
    const span = lodgingDays(s);
    const day = span && [...days].find((d) => d >= span.first && d <= span.last);
    if (!day) continue;
    consider(
      {
        kind: "lodging",
        id: s.id,
        lodgingId: s.lodging.id,
        name: s.lodging.name,
        distanceM: Math.round(meters({ lat, lon }, target)),
        day,
      },
      LODGING_RADIUS_M
    );
  }
  for (const f of ctx.flights ?? []) {
    if (f.status === "cancelled" || !tripAllows(target, f.tripId)) continue;
    const ends = [
      { at: f.departureTime, lat: f.depLat, lon: f.depLon, iata: f.depIata },
      { at: f.arrivalTime, lat: f.arrLat, lon: f.arrLon, iata: f.arrIata },
    ];
    for (const end of ends) {
      if (!end.at || !days.has(dayOf(end.at))) continue;
      consider(
        {
          kind: "flight",
          id: f.id,
          name: [f.flightNumber, end.iata].filter(Boolean).join(" · ") || "—",
          distanceM: Math.round(meters(end, target)),
          day: dayOf(end.at),
        },
        AIRPORT_RADIUS_M
      );
    }
  }

  if (best) return { covered: best, nearPlace: null };
  let near: CoverVerdict["nearPlace"] = null;
  for (const p of ctx.places ?? []) {
    const distanceM = Math.round(meters(p, target));
    if (distanceM > radiusFor(p.category) || (near && near.distanceM <= distanceM)) continue;
    near = { id: p.id, name: p.name, localName: p.localName ?? null, distanceM };
  }
  return { covered: null, nearPlace: near };
}

/**
 * Every entry that could cover a suggestion between `from` and `to`. A local
 * day starts up to 14 h before and ends up to 12 h after its UTC date, and an
 * overnight suggestion reaches one day further, so the day-dated columns get
 * two days of margin on each side.
 */
export async function loadCoverContext(
  userId: string,
  from: Date,
  to: Date,
  opts: { flights?: boolean; places?: boolean } = {}
): Promise<CoverContext> {
  const lo = new Date(Date.parse(from.toISOString().slice(0, 10)) - 2 * DAY_MS);
  const hi = new Date(Date.parse(to.toISOString().slice(0, 10)) + 3 * DAY_MS);
  const range = { gte: lo, lte: hi };
  const [visits, lodgingStays, flights, places] = await Promise.all([
    prisma.placeVisit.findMany({
      where: {
        userId,
        OR: [{ visitedAtUtc: range }, { visitedAtUtc: null, visitedAt: range }],
      },
      select: {
        id: true,
        tripId: true,
        visitedAt: true,
        visitedAtUtc: true,
        visitedZone: true,
        visitedPrecision: true,
        suggestionRef: true,
        place: { select: { id: true, name: true, lat: true, lon: true, category: true } },
      },
    }),
    prisma.lodgingStay.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        lodging: { lat: { not: null }, lon: { not: null } },
        OR: [
          { checkInDate: { lte: hi }, checkOutDate: { gte: lo } },
          { checkInDate: null, checkIn: { lte: hi }, checkOut: { gte: lo } },
        ],
      },
      select: {
        id: true,
        tripId: true,
        checkIn: true,
        checkOut: true,
        checkInDate: true,
        checkOutDate: true,
        lodging: { select: { id: true, name: true, lat: true, lon: true } },
      },
    }),
    opts.flights
      ? prisma.flight.findMany({
          where: {
            userId,
            status: { not: "cancelled" },
            OR: [{ departureTime: range }, { arrivalTime: range }],
          },
          select: {
            id: true,
            tripId: true,
            flightNumber: true,
            status: true,
            departureTime: true,
            arrivalTime: true,
            depIata: true,
            depLat: true,
            depLon: true,
            arrIata: true,
            arrLat: true,
            arrLon: true,
          },
        })
      : Promise.resolve([]),
    opts.places
      ? prisma.place.findMany({
          where: { userId },
          select: { id: true, name: true, localName: true, lat: true, lon: true, category: true },
        })
      : Promise.resolve([]),
  ]);
  return { visits, lodgingStays, flights, places };
}
