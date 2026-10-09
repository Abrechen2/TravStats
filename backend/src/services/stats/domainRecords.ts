import { prisma } from "../../db";
import { countableCruiseWhere } from "../../shared/cruiseCounting";
import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { classifyVisit } from "../../shared/placeCounting";
import { countableRailWhere } from "../../shared/railCounting";
import { rideKm } from "../../shared/railRideKinds";
import { countableRentalWhere, rentalDays } from "../../shared/rentalCounting";
import { countableBusWhere } from "../../shared/busCounting";
import { now as clockNow } from "../../shared/time/clock";
import type { DomainKey } from "../../shared/domains";
import { loadVisibleDomainSet, type VisibleDomains } from "../domainVisibility";
import { roadtripAttestedSpan } from "./roadtripEvidence";
import type { DomainRecord } from "../../schemas/statsDomainRecords";

/**
 * Travel records beyond flights (forgejo#265): the record each further domain
 * the user sees can hold — the longest cruise, stay, roadtrip, rental, train
 * and bus ride, the most visited place. `/stats/records` keeps the flight
 * records; these sit beside them, one per domain, each in its own unit, so a
 * cruise of 14 days and a train ride of 1,200 km are never ranked against
 * each other.
 *
 * Each record counts by its domain's own rule (`*Counting.ts`) and links to
 * the entry that holds it. A domain the user does not see — switched off, or
 * behind the beta switch — has no record. A domain with nothing measurable
 * has none either: a record that cannot be derived is omitted, never zero
 * (`records.ts`' rule).
 */

const DAY_MS = 86_400_000;
const utcDayOf = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function longest<T>(
  rows: readonly T[],
  measure: (row: T) => number | null
): { row: T; value: number } | null {
  let best: { row: T; value: number } | null = null;
  for (const row of rows) {
    const value = measure(row);
    if (value === null || value <= 0) continue;
    if (best === null || value > best.value) best = { row, value };
  }
  return best;
}

async function cruiseRecord(userId: string): Promise<DomainRecord | null> {
  const cruises = await prisma.cruise.findMany({
    where: { userId, ...countableCruiseWhere() },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      routeName: true,
      shipNameOverride: true,
      ship: { select: { name: true } },
    },
  });
  // Calendar days aboard, both ends counted — a cruise's dates are calendar dates.
  const best = longest(cruises, (c) =>
    c.startDate && c.endDate
      ? Math.round((utcDayOf(c.endDate) - utcDayOf(c.startDate)) / DAY_MS) + 1
      : null
  );
  if (!best) return null;
  const c = best.row;
  return {
    domain: "cruise",
    id: "longest-cruise",
    value: best.value,
    unit: "days",
    entryId: c.id,
    href: `/cruises/${c.id}`,
    label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? null,
  };
}

async function stayRecord(userId: string, now: Date): Promise<DomainRecord | null> {
  const stays = await prisma.lodgingStay.findMany({
    where: { userId },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      datePrecision: true,
      nights: true,
      lodgingId: true,
      lodging: { select: { name: true } },
    },
  });
  const best = longest(
    stays.filter((s) => classifyStay(s, now) === "visited"),
    (s) => {
      const timing = resolveStayTiming(s);
      return timing.nightsKnown ? timing.nights : null;
    }
  );
  if (!best) return null;
  return {
    domain: "lodging",
    id: "longest-stay",
    value: best.value,
    unit: "nights",
    entryId: best.row.id,
    href: `/lodging/${best.row.lodgingId}`,
    label: best.row.lodging.name,
  };
}

async function placeRecord(userId: string, now: Date): Promise<DomainRecord | null> {
  const places = await prisma.place.findMany({
    where: { userId },
    select: { id: true, name: true, visits: { select: { visitedAt: true, visitedAtUtc: true } } },
  });
  const best = longest(
    places,
    (p) => p.visits.filter((v) => classifyVisit(v, now) === "visited").length
  );
  // One visit is no record of returning.
  if (!best || best.value < 2) return null;
  return {
    domain: "poi",
    id: "most-visited-place",
    value: best.value,
    unit: "visits",
    entryId: best.row.id,
    href: `/places/${best.row.id}`,
    label: best.row.name,
  };
}

async function roadtripRecord(userId: string, now: Date): Promise<DomainRecord | null> {
  const routes = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      id: true,
      name: true,
      stops: {
        where: { viaPoint: false },
        select: {
          lodgingStayId: true,
          overnight: true,
          startDate: true,
          endDate: true,
          lodgingStay: {
            select: {
              checkIn: true,
              checkOut: true,
              datePrecision: true,
              nights: true,
              status: true,
            },
          },
        },
      },
    },
  });
  // Calendar days the roadtrip ATTESTS, first to last, both counted — the
  // passport's station rule (`roadtripAttestedSpan`): no planned station, no
  // day after today, no cancelled stay, no MONTH placeholder (review I2).
  const best = longest(routes, (r) => {
    const span = roadtripAttestedSpan(r.stops, now);
    return span === null
      ? null
      : Math.round((Date.parse(span.last) - Date.parse(span.first)) / DAY_MS) + 1;
  });
  if (!best) return null;
  return {
    domain: "roadtrip",
    id: "longest-roadtrip",
    value: best.value,
    unit: "days",
    entryId: best.row.id,
    href: `/roadtrips/${best.row.id}`,
    label: best.row.name,
  };
}

async function railRecord(userId: string): Promise<DomainRecord | null> {
  const rides = await prisma.railJourney.findMany({
    where: { userId, ...countableRailWhere() },
    select: {
      id: true,
      depStationName: true,
      arrStationName: true,
      distanceKm: true,
      distanceSource: true,
    },
  });
  const best = longest(rides, (r) => rideKm(r));
  if (!best) return null;
  return {
    domain: "rail",
    id: "longest-rail-ride",
    value: Math.round(best.value),
    unit: "km",
    entryId: best.row.id,
    href: `/rail/${best.row.id}`,
    label: `${best.row.depStationName} → ${best.row.arrStationName}`,
    distanceSource: best.row.distanceSource,
  };
}

async function rentalRecord(userId: string): Promise<DomainRecord | null> {
  const rentals = await prisma.rentalBooking.findMany({
    where: { userId, ...countableRentalWhere() },
    select: {
      id: true,
      provider: true,
      pickupTime: true,
      pickupTimezone: true,
      returnTime: true,
      returnTimezone: true,
    },
  });
  const best = longest(rentals, (r) => rentalDays(r));
  if (!best) return null;
  return {
    domain: "rental",
    id: "longest-rental",
    value: best.value,
    unit: "days",
    entryId: best.row.id,
    href: `/rentals/${best.row.id}`,
    label: best.row.provider,
  };
}

async function busRecord(userId: string): Promise<DomainRecord | null> {
  const rides = await prisma.busJourney.findMany({
    where: { userId, ...countableBusWhere() },
    select: {
      id: true,
      depStationName: true,
      arrStationName: true,
      distanceKm: true,
      distanceSource: true,
    },
  });
  const best = longest(rides, (r) => r.distanceKm);
  if (!best) return null;
  return {
    domain: "bus",
    id: "longest-bus-ride",
    value: Math.round(best.value),
    unit: "km",
    entryId: best.row.id,
    href: `/bus/${best.row.id}`,
    label: `${best.row.depStationName} → ${best.row.arrStationName}`,
    distanceSource: best.row.distanceSource,
  };
}

const RECORDS: Partial<
  Record<DomainKey, (userId: string, now: Date) => Promise<DomainRecord | null>>
> = {
  cruise: cruiseRecord,
  lodging: stayRecord,
  poi: placeRecord,
  roadtrip: roadtripRecord,
  rail: railRecord,
  rental: rentalRecord,
  bus: busRecord,
};

/** The records of the domains `visible` names, in registry order. */
export async function loadDomainRecords(
  userId: string,
  visible?: VisibleDomains
): Promise<DomainRecord[]> {
  const seen = visible ?? (await loadVisibleDomainSet(userId));
  const now = clockNow();
  const loaded = await Promise.all(
    (Object.keys(RECORDS) as DomainKey[])
      .filter((domain) => seen.has(domain))
      .map((domain) => RECORDS[domain]!(userId, now))
  );
  return loaded.filter((r): r is DomainRecord => r !== null);
}
