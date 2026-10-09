/**
 * The package proposal's matching rules, extended past flights, stays and
 * cruises (spec 2026-10-09 S3) — to what a `.travstats` file carries besides:
 *
 *   rail     the provenance key, else the same operator and train number, or
 *            the same two stations, departing on the same LOCAL day
 *   rental   the provenance key, else the same provider picking up on the
 *            same local day
 *   place    the provenance key, else the nearest of the user's places within
 *            100 m
 *   visit    the same place on the same local day
 *   stop     on the trip already chosen: the same place (or, without one, the
 *            same title) on the same local day
 *
 * Read-only, like `matching.ts`. "Same day" is always the day at the entry's
 * own place, read from the zone stored beside the instant (ADR 0002).
 */
import { prisma } from "../../../db";
import { haversineKm } from "../../../shared/geo/haversine";
import { localDay } from "../../../shared/time/instant";
import { normalizeLodgingName } from "../../lodging/lodgingImportPreview";
import { addDays } from "./contract";
import type { ExistingEntry } from "./matching";

/** Places closer than this are the same place. */
export const PLACE_MATCH_KM = 0.1;

/** The calendar day of an instant at its zone; the UTC day when no zone is stored. */
export function dayAt(instant: Date | string | null, zone: string | null): string | null {
  if (!instant) return null;
  return localDay(instant, zone ?? "UTC");
}

/** The UTC window that surely holds every instant whose local day is `day`. */
function windowAround(day: string): { gte: Date; lt: Date } {
  return {
    gte: new Date(`${addDays(day, -1)}T00:00:00Z`),
    lt: new Date(`${addDays(day, 2)}T00:00:00Z`),
  };
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  Boolean(a && b && normalizeLodgingName(a) === normalizeLodgingName(b));

// ------------------------------------------------------------------ rail

export interface RailQuery {
  externalRef: string | null;
  operator: string | null;
  trainNumber: string | null;
  depName: string;
  arrName: string;
  /** Local day of departure. */
  day: string;
}

export async function existingRail(userId: string, q: RailQuery): Promise<ExistingEntry | null> {
  const select = { id: true, tripId: true, bookingId: true } as const;
  if (q.externalRef) {
    const byRef = await prisma.railJourney.findFirst({
      where: { userId, externalRef: q.externalRef },
      select,
    });
    if (byRef) return byRef;
  }
  const rows = await prisma.railJourney.findMany({
    where: { userId, departureTime: windowAround(q.day) },
    select: {
      ...select,
      operator: true,
      trainNumber: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
    },
    take: 50,
  });
  const hit = rows.find(
    (r) =>
      dayAt(r.departureTime, r.depTimezone) === q.day &&
      ((same(r.operator, q.operator) && same(r.trainNumber, q.trainNumber)) ||
        (same(r.depStationName, q.depName) && same(r.arrStationName, q.arrName)))
  );
  return hit ? { id: hit.id, tripId: hit.tripId, bookingId: hit.bookingId } : null;
}

// ------------------------------------------------------------------ rental

export interface RentalQuery {
  externalRef: string | null;
  provider: string;
  /** Local day of pick-up. */
  day: string;
}

/** Rentals carry no booking: `bookingId` is always null here. */
export async function existingRental(
  userId: string,
  q: RentalQuery
): Promise<ExistingEntry | null> {
  if (q.externalRef) {
    const byRef = await prisma.rentalBooking.findFirst({
      where: { userId, externalRef: q.externalRef },
      select: { id: true, tripId: true },
    });
    if (byRef) return { ...byRef, bookingId: null };
  }
  const rows = await prisma.rentalBooking.findMany({
    where: { userId, pickupTime: windowAround(q.day) },
    select: { id: true, tripId: true, provider: true, pickupTime: true, pickupTimezone: true },
    take: 50,
  });
  const hit = rows.find(
    (r) => same(r.provider, q.provider) && dayAt(r.pickupTime, r.pickupTimezone) === q.day
  );
  return hit ? { id: hit.id, tripId: hit.tripId, bookingId: null } : null;
}

// ------------------------------------------------------------------ places

export interface PlaceQuery {
  externalRef: string | null;
  lat: number;
  lon: number;
}

export async function existingPlace(userId: string, q: PlaceQuery): Promise<string | null> {
  if (q.externalRef) {
    const byRef = await prisma.place.findFirst({
      where: { userId, externalRef: q.externalRef },
      select: { id: true },
    });
    if (byRef) return byRef.id;
  }
  // A box a little wider than the radius, then the exact distance.
  const dLat = 0.0015;
  const dLon = dLat / Math.max(Math.cos((q.lat * Math.PI) / 180), 0.01);
  const near = await prisma.place.findMany({
    where: {
      userId,
      lat: { gte: q.lat - dLat, lte: q.lat + dLat },
      lon: { gte: q.lon - dLon, lte: q.lon + dLon },
    },
    select: { id: true, lat: true, lon: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let best: { id: string; km: number } | null = null;
  for (const p of near) {
    const km = haversineKm(p, q);
    if (km <= PLACE_MATCH_KM && (!best || km < best.km)) best = { id: p.id, km };
  }
  return best?.id ?? null;
}

/** A visit of `placeId` on the local `day`. Visits carry no booking. */
export async function existingVisit(
  userId: string,
  placeId: string,
  day: string | null
): Promise<ExistingEntry | null> {
  const rows = await prisma.placeVisit.findMany({
    where: { userId, placeId },
    select: { id: true, tripId: true, visitedAt: true, visitedAtUtc: true, visitedZone: true },
    take: 200,
  });
  const hit = rows.find((v) => visitDay(v) === day);
  return hit ? { id: hit.id, tripId: hit.tripId, bookingId: null } : null;
}

export function visitDay(v: {
  visitedAt: Date | string | null;
  visitedAtUtc: Date | string | null;
  visitedZone: string | null;
}): string | null {
  if (v.visitedAtUtc && v.visitedZone) return dayAt(v.visitedAtUtc, v.visitedZone);
  if (!v.visitedAt) return null;
  return typeof v.visitedAt === "string" ? v.visitedAt.slice(0, 10) : dayAt(v.visitedAt, null);
}

// ------------------------------------------------------------------ stops

export interface StopQuery {
  placeId: string | null;
  title: string;
  day: string | null;
}

export function stopDay(s: {
  startDate: Date | string | null;
  startUtc: Date | string | null;
  stopZone: string | null;
}): string | null {
  if (s.startUtc && s.stopZone) return dayAt(s.startUtc, s.stopZone);
  if (!s.startDate) return null;
  return typeof s.startDate === "string" ? s.startDate.slice(0, 10) : dayAt(s.startDate, null);
}

/** Stops live only on a trip: matched on the trip the import lands on, nowhere else. */
export async function existingStop(tripId: string, q: StopQuery): Promise<string | null> {
  const rows = await prisma.tripStop.findMany({
    where: { tripId, routeId: null },
    select: {
      id: true,
      placeId: true,
      title: true,
      startDate: true,
      startUtc: true,
      stopZone: true,
    },
    take: 1000,
  });
  const hit = rows.find(
    (s) =>
      stopDay(s) === q.day &&
      (q.placeId ? s.placeId === q.placeId : !s.placeId && same(s.title, q.title))
  );
  return hit?.id ?? null;
}
