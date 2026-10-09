import { prisma } from "../../db";
import { busCountries, busYear, countableBusWhere } from "../../shared/busCounting";
import { rideHasClocks } from "../../shared/railClock";
import { operatorKey } from "../../shared/railRideKinds";
import { transferMinutes } from "../../shared/railJourneyGrouping";
import { localDay } from "../../shared/time/instant";
import {
  busConnectionKey,
  inTravelOrder,
  isNightBusRide,
  nightBusNights,
  terminalsOf,
  longestReturnDays,
  type TerminalEvent,
} from "../../shared/busRideKinds";
import { railJourneysOf } from "../rail/railJourneyStats";

/**
 * The bus statistics (spec 2026-10-07-bus-domain-design §6, package B2;
 * forgejo#263), over the rides `shared/busCounting.ts` counts — completed
 * only, each filed under the year it LEFT on its departure terminal's
 * calendar. Rail's `railStats.ts` is the template, minus train categories and
 * plus ride kinds, and its three rules hold here too:
 *
 *  - **A distance says what it measures.** Kilometres per source (straight
 *    line, which understates a road by 10–40 %; the routed road line; the
 *    ticket's figure), never one undifferentiated figure; a ride with no
 *    distance is counted as such, not as 0 km.
 *  - **Abstention is a result.** Hours on board need both clocks, a delay a
 *    recorded delay and both clocks; the sample size travels with each figure.
 *  - **A missing time is never invented.** A night bus is one whose clocks say
 *    it ran overnight (`shared/busRideKinds.ts`); a date-only ride is none.
 *
 * Journeys and changes use rail's grouping rule (`railJourneysOf`): only
 * rides of the same booking that meet at a terminal within four hours are one
 * journey — a coach connection is sold on one booking as a train connection
 * is (spec §13, forgejo#187) — and rides with no booking are never joined.
 */

const TOP = 10;
const DELAY_BUCKETS = [0, 5, 15, 30, 60] as const;
const FAVOURITE_MIN_RIDES = 2;

export interface BusStatsRow {
  id: string;
  operator: string | null;
  rideKind: string | null;
  depStationName: string;
  arrStationName: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  depCountry: string | null;
  arrCountry: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depPrecision: string | null;
  arrPrecision: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  delayMinutes: number | null;
  bookingId: string | null;
}

export interface Ranked {
  label: string;
  count: number;
}

export interface BusStats {
  rides: number;
  distance: {
    totalKm: number;
    straightLineKm: number;
    routeKm: number;
    ticketKm: number;
    unmeasuredRides: number;
  };
  hoursOnBoard: { hours: number; measuredRides: number };
  countries: string[];
  operators: Ranked[];
  /** intercity | shuttle | other | unknown (no kind recorded). */
  rideKinds: Ranked[];
  /** Departures plus arrivals per terminal (stable identity), top ten. */
  terminals: Ranked[];
  terminalsVisited: number;
  longest: {
    id: string;
    depStationName: string;
    arrStationName: string;
    distanceKm: number;
    distanceSource: string | null;
  } | null;
  delays: {
    recordedRides: number;
    buckets: Array<{ upToMinutes: number | null; count: number }>;
    averageMinutes: number | null;
  };
  /** `km` null when no ride of the year has a distance — unknown, never 0 (review I4). */
  byYear: Array<{ year: number; rides: number; km: number | null; unmeasured: number }>;
  journeys: { total: number; withTransfer: number };
  transfers: { count: number; averageMinutes: number | null };
  favouriteConnections: Array<{ from: string; to: string; rides: number; latestRideId: string }>;
  newDestinations: { inScope: number; byYear: Array<{ year: number; count: number }> };
  /** The longest wait before coming back to a terminal, in days; null when none was revisited. */
  longestReturn: { days: number; terminal: string } | null;
  night: { rides: number; nights: number };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const rankMap = (counts: Map<string, number>): Ranked[] =>
  [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP);

/** A recorded delay on a ride with both clocks — the only delay that is a measurement. */
const delayOf = (r: BusStatsRow): number | null =>
  r.delayMinutes !== null && r.arrivalTime !== null && rideHasClocks(r) ? r.delayMinutes : null;

function delays(rows: readonly BusStatsRow[]): BusStats["delays"] {
  const recorded = rows.flatMap((r) => {
    const d = delayOf(r);
    return d === null ? [] : [d];
  });
  const buckets = [...DELAY_BUCKETS, null].map((upTo, i) => {
    const lower = i === 0 ? -Infinity : DELAY_BUCKETS[i - 1];
    return {
      upToMinutes: upTo,
      count: recorded.filter((d) => d > lower && (upTo === null || d <= upTo)).length,
    };
  });
  return {
    recordedRides: recorded.length,
    buckets,
    averageMinutes:
      recorded.length === 0 ? null : round1(recorded.reduce((a, b) => a + b, 0) / recorded.length),
  };
}

function operators(rows: readonly BusStatsRow[]): Ranked[] {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = operatorKey(r.operator);
    if (key === null) continue;
    if (!labels.has(key)) labels.set(key, (r.operator as string).trim());
    const label = labels.get(key)!;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return rankMap(counts);
}

/** Terminal figures over EVERY ride (identity must not depend on the period), cut to the scope. */
function terminalFigures(
  scoped: readonly BusStatsRow[],
  all: readonly BusStatsRow[]
): Pick<
  BusStats,
  "terminals" | "terminalsVisited" | "favouriteConnections" | "newDestinations" | "longestReturn"
> {
  const { registry, ends } = terminalsOf(all);
  const scopedIds = new Set(scoped.map((r) => r.id));
  const inScope = inTravelOrder(scoped);

  const visits = new Map<number, number>();
  const connections = new Map<string, { rides: number; latest: BusStatsRow }>();
  for (const ride of inScope) {
    const e = ends.get(ride.id)!;
    visits.set(e.dep, (visits.get(e.dep) ?? 0) + 1);
    visits.set(e.arr, (visits.get(e.arr) ?? 0) + 1);
    const key = busConnectionKey(e);
    if (key === null) continue;
    const entry = connections.get(key);
    connections.set(key, { rides: (entry?.rides ?? 0) + 1, latest: ride });
  }

  // A new destination: the first ride that ARRIVES at a terminal no earlier
  // ride touched. The home terminal a logbook starts from is never one.
  const seen = new Set<number>();
  const firstArrivals: BusStatsRow[] = [];
  const visitEvents = new Map<number, TerminalEvent[]>();
  for (const ride of inTravelOrder(all)) {
    const e = ends.get(ride.id)!;
    if (!seen.has(e.arr) && e.arr !== e.dep) firstArrivals.push(ride);
    seen.add(e.dep);
    seen.add(e.arr);
    visitEvents.set(e.dep, [
      ...(visitEvents.get(e.dep) ?? []),
      {
        kind: "dep",
        at: ride.departureTime,
        day: localDay(ride.departureTime, ride.depTimezone ?? "UTC"),
      },
    ]);
    if (ride.arrivalTime) {
      visitEvents.set(e.arr, [
        ...(visitEvents.get(e.arr) ?? []),
        {
          kind: "arr",
          at: ride.arrivalTime,
          day: localDay(ride.arrivalTime, ride.arrTimezone ?? "UTC"),
        },
      ]);
    }
  }
  const destinationsByYear = new Map<number, number>();
  for (const ride of firstArrivals) {
    const year = busYear(ride);
    destinationsByYear.set(year, (destinationsByYear.get(year) ?? 0) + 1);
  }

  // Between two SEPARATE visits — an arrival and the ride out of the same stay
  // are one visit, never a return (`longestReturnDays`, review I3).
  let longestReturn: BusStats["longestReturn"] = null;
  for (const [terminal, events] of visitEvents) {
    const days = longestReturnDays(events);
    if (days !== null && (longestReturn === null || days > longestReturn.days)) {
      longestReturn = { days, terminal: registry.nameOf(terminal) };
    }
  }

  const label = (key: string): { from: string; to: string } => {
    const [a, b] = key.split("|").map((id) => registry.nameOf(Number(id)));
    return a.localeCompare(b) <= 0 ? { from: a, to: b } : { from: b, to: a };
  };
  return {
    terminals: [...visits.entries()]
      .map(([id, count]) => ({ label: registry.nameOf(id), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, TOP),
    terminalsVisited: visits.size,
    favouriteConnections: [...connections.entries()]
      .filter(([, v]) => v.rides >= FAVOURITE_MIN_RIDES)
      .map(([key, v]) => ({ ...label(key), rides: v.rides, latestRideId: v.latest.id }))
      .sort((a, b) => b.rides - a.rides || a.from.localeCompare(b.from))
      .slice(0, 5),
    newDestinations: {
      inScope: firstArrivals.filter((r) => scopedIds.has(r.id)).length,
      byYear: [...destinationsByYear.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year),
    },
    longestReturn,
  };
}

function journeyFigures(rows: readonly BusStatsRow[]): Pick<BusStats, "journeys" | "transfers"> {
  const journeys = railJourneysOf(rows);
  const waits: number[] = [];
  for (const journey of journeys) {
    for (let i = 1; i < journey.length; i += 1) {
      const wait = transferMinutes(journey[i - 1], journey[i]);
      if (wait !== null) waits.push(wait);
    }
  }
  return {
    journeys: { total: journeys.length, withTransfer: journeys.filter((j) => j.length > 1).length },
    transfers: {
      count: waits.length,
      averageMinutes:
        waits.length === 0 ? null : round1(waits.reduce((a, b) => a + b, 0) / waits.length),
    },
  };
}

/**
 * @param all every counted ride — terminal identity, new destinations and the
 *            longest return are lifetime questions a period cut cannot answer.
 */
export function computeBusStats(
  rows: readonly BusStatsRow[],
  all: readonly BusStatsRow[] = rows
): BusStats {
  const measured = rows.filter((r) => r.distanceKm !== null);
  const sumKm = (source: string): number =>
    measured
      .filter((r) => r.distanceSource === source)
      .reduce((s, r) => s + (r.distanceKm as number), 0);
  const timed = rows.filter(
    (r) =>
      r.arrivalTime !== null &&
      rideHasClocks(r) &&
      r.arrivalTime.getTime() >= r.departureTime.getTime()
  );
  const longest = measured.reduce<BusStatsRow | null>(
    (best, r) =>
      best === null || (r.distanceKm as number) > (best.distanceKm as number) ? r : best,
    null
  );
  const years = new Map<number, { rides: number; km: number | null; unmeasured: number }>();
  const kinds = new Map<string, number>();
  for (const r of rows) {
    const year = busYear(r);
    const entry = years.get(year) ?? { rides: 0, km: null, unmeasured: 0 };
    years.set(year, {
      rides: entry.rides + 1,
      km: r.distanceKm === null ? entry.km : (entry.km ?? 0) + r.distanceKm,
      unmeasured: entry.unmeasured + (r.distanceKm === null ? 1 : 0),
    });
    const kind = r.rideKind ?? "unknown";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const nightRides = rows.filter(isNightBusRide);

  return {
    rides: rows.length,
    distance: {
      totalKm: measured.reduce((s, r) => s + (r.distanceKm as number), 0),
      straightLineKm: sumKm("great_circle"),
      routeKm: sumKm("route"),
      ticketKm: sumKm("user"),
      unmeasuredRides: rows.length - measured.length,
    },
    hoursOnBoard: {
      hours:
        timed.reduce(
          (s, r) => s + ((r.arrivalTime as Date).getTime() - r.departureTime.getTime()),
          0
        ) / 3_600_000,
      measuredRides: timed.length,
    },
    countries: [...new Set(rows.flatMap(busCountries))].sort(),
    operators: operators(rows),
    rideKinds: rankMap(kinds),
    ...terminalFigures(rows, all),
    longest: longest
      ? {
          id: longest.id,
          depStationName: longest.depStationName,
          arrStationName: longest.arrStationName,
          distanceKm: longest.distanceKm as number,
          distanceSource: longest.distanceSource,
        }
      : null,
    delays: delays(rows),
    byYear: [...years.entries()]
      .map(([year, v]) => ({ year, ...v }))
      .sort((a, b) => a.year - b.year),
    ...journeyFigures(rows),
    night: {
      rides: nightRides.length,
      nights: nightRides.reduce((n, r) => n + nightBusNights(r).length, 0),
    },
  };
}

export const BUS_STATS_SELECT = {
  id: true,
  operator: true,
  rideKind: true,
  depStationName: true,
  arrStationName: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  depCountry: true,
  arrCountry: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
  distanceKm: true,
  distanceSource: true,
  delayMinutes: true,
  bookingId: true,
} as const;

/** The counted rides, oldest first — the population of the tab, the evidence and the badges. */
export async function loadBusRows(userId: string): Promise<BusStatsRow[]> {
  return prisma.busJourney.findMany({
    where: { userId, ...countableBusWhere() },
    select: BUS_STATS_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
}

/** A ride is in the period when it left in `year`, up to "MM-DD" on its terminal's calendar. */
export function inBusPeriod(
  r: Pick<BusStatsRow, "departureTime" | "depTimezone" | "arrivalTime" | "arrTimezone">,
  year: number | null,
  until: string | null
): boolean {
  if (year === null) return true;
  if (busYear(r) !== year) return false;
  return until === null || localDay(r.departureTime, r.depTimezone ?? "UTC") <= `${year}-${until}`;
}

export async function loadBusStats(
  userId: string,
  year: number | null,
  until: string | null = null
): Promise<BusStats> {
  const rows = await loadBusRows(userId);
  return computeBusStats(
    rows.filter((r) => inBusPeriod(r, year, until)),
    rows
  );
}
