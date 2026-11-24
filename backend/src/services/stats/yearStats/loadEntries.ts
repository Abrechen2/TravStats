import { prisma } from "../../../db";
import { countableFlightWhere } from "../../../shared/flightCounting";
import { countableCruiseWhere } from "../../../shared/cruiseCounting";
import { countableRailWhere } from "../../../shared/railCounting";
import { countableBusWhere } from "../../../shared/busCounting";
import { countableFerryWhere } from "../../../shared/ferryCounting";
import { countableRentalWhere, rentalDrivenKm } from "../../../shared/rentalCounting";
import { localDay } from "../../../shared/time/instant";
import { calculateDistance } from "../../../utils/geo";
import { localWallClockOf } from "../../../utils/timezone";
import { travelledKm } from "../../tour/tourDistance";
import { roadtripHasStarted } from "../roadtripEvidence";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "../departureClock";
import { loadVisibleDomainSet, type VisibleDomains } from "../../domainVisibility";
import type { DomainKey } from "../../../shared/domains";
import type { DistanceEntry } from "../../../utils/stats/yearStats";

/**
 * Every distance-bearing entry of the domains the user sees, as `{domain, month, km}` — one
 * query per domain, however many years there are. Each is counted and filed by its domain's
 * own rule (the same ones `/stats/wrapped` reads): the month is the one on the entry's own
 * calendar (a flight on the departure airport's clock), and an entry nobody measured carries
 * `km: null` instead of 0.
 *
 * The reads go through Prisma on purpose: "Nur belegte" and the hidden purposes are applied
 * to them by the request scope, so this statistic agrees with every other one.
 */

const monthOf = (day: string): string => day.slice(0, 7);
const sum = (rows: readonly { distanceKm: number }[]): number | null =>
  rows.length > 0 ? rows.reduce((n, r) => n + r.distanceKm, 0) : null;

type Loader = (userId: string, now: Date) => Promise<DistanceEntry[]>;

const loadFlights: Loader = async (userId) => {
  const rows = await withDepartureClock(
    await prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      select: {
        ...FLIGHT_CLOCK_SELECT,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
      },
    })
  );
  return rows.flatMap((f) => {
    if (f.departureTime === null) return [];
    const at = localWallClockOf(f.departureTime, f.depTimezone, f.depTimeSemantics);
    // Missing coordinates make `calculateDistance` answer 0: that is no distance, not 0 km.
    const km = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return [
      {
        domain: "flight" as const,
        month: `${at.year}-${String(at.month + 1).padStart(2, "0")}`,
        km: km > 0 ? km : null,
      },
    ];
  });
};

const loadCruises: Loader = async (userId) => {
  const rows = await prisma.cruise.findMany({
    where: { userId, ...countableCruiseWhere(), startDate: { not: null } },
    select: { startDate: true, legs: { select: { distanceKm: true } } },
  });
  return rows.flatMap((c) =>
    c.startDate
      ? [
          {
            domain: "cruise" as const,
            month: c.startDate.toISOString().slice(0, 7),
            km: sum(c.legs),
          },
        ]
      : []
  );
};

function ride(domain: DomainKey) {
  return (r: {
    departureTime: Date;
    depTimezone: string | null;
    distanceKm: number | null;
  }): DistanceEntry => ({
    domain,
    month: monthOf(localDay(r.departureTime, r.depTimezone ?? "UTC")),
    km: r.distanceKm,
  });
}

const rideSelect = {
  departureTime: true,
  depTimezone: true,
  distanceKm: true,
} as const;

const loadRail: Loader = async (userId) =>
  (
    await prisma.railJourney.findMany({
      where: { userId, ...countableRailWhere() },
      select: rideSelect,
    })
  ).map(ride("rail"));

const loadBus: Loader = async (userId) =>
  (
    await prisma.busJourney.findMany({
      where: { userId, ...countableBusWhere() },
      select: rideSelect,
    })
  ).map(ride("bus"));

const loadFerry: Loader = async (userId) =>
  (
    await prisma.ferryJourney.findMany({
      where: { userId, ...countableFerryWhere() },
      select: rideSelect,
    })
  ).map(ride("ferry"));

const loadRentals: Loader = async (userId) =>
  (
    await prisma.rentalBooking.findMany({
      where: { userId, ...countableRentalWhere() },
      select: {
        pickupTime: true,
        pickupTimezone: true,
        distanceKm: true,
        distanceSource: true,
        odometerOutKm: true,
        odometerInKm: true,
      },
    })
  ).map((r) => ({
    domain: "rental" as const,
    month: monthOf(localDay(r.pickupTime, r.pickupTimezone)),
    km: rentalDrivenKm(r)?.km ?? null,
  }));

const loadRoadtrips: Loader = async (userId, now) => {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      legs: { select: { distanceKm: true } },
      stops: {
        where: { viaPoint: false },
        select: { startDate: true, lodgingStay: { select: { checkIn: true } } },
      },
    },
  });
  return rows.flatMap((route) => {
    const starts = route.stops
      .map((s) => s.startDate ?? s.lodgingStay?.checkIn ?? null)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    // A roadtrip with no dated station has started in no particular month; a planned one has not.
    if (starts.length === 0 || !roadtripHasStarted(route.stops, now)) return [];
    return [
      {
        domain: "roadtrip" as const,
        month: starts[0].toISOString().slice(0, 7),
        km: route.legs.length > 0 ? travelledKm(route.legs) : null,
      },
    ];
  });
};

const loadTours: Loader = async (userId, now) => {
  const today = now.toISOString().slice(0, 10);
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "tour", tourDate: { not: null } },
    select: {
      tourDate: true,
      legs: { select: { distanceKm: true } },
      tracks: { select: { distanceKm: true } },
    },
  });
  return rows.flatMap((route) => {
    // A floating date: its stored components ARE the day (ADR 0002 D1).
    const day = route.tourDate?.toISOString().slice(0, 10);
    if (!day || day > today) return [];
    // A recording measures a day tour better than its drawn legs.
    const km = route.tracks.length > 0 ? sum(route.tracks) : sum(route.legs);
    return [{ domain: "tour" as const, month: monthOf(day), km }];
  });
};

const LOADERS: ReadonlyArray<readonly [DomainKey, Loader]> = [
  ["flight", loadFlights],
  ["cruise", loadCruises],
  ["rail", loadRail],
  ["bus", loadBus],
  ["ferry", loadFerry],
  ["rental", loadRentals],
  ["roadtrip", loadRoadtrips],
  ["tour", loadTours],
];

export async function loadDistanceEntries(
  userId: string,
  now: Date,
  visible?: VisibleDomains
): Promise<DistanceEntry[]> {
  const shown = visible ?? (await loadVisibleDomainSet(userId));
  const parts = await Promise.all(
    LOADERS.filter(([domain]) => shown.has(domain)).map(([, load]) => load(userId, now))
  );
  return parts.flat();
}
