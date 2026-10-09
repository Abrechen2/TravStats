import { prisma } from "../../db";
import {
  countableRailWhere,
  railCountries,
  railYear,
  stationDayKey,
  type DatedRail,
} from "../../shared/railCounting";
import { railRideFacts } from "../../utils/railAchievements";
import { rideHasClocks } from "../../shared/railClock";
import { railStationKey } from "../../shared/railConnections";
import { computeRailJourneyFigures, type RailJourneyFigures } from "./railJourneyStats";

/**
 * The rail statistics (spec 2026-09-25-rail-domain, phase 2b), computed from
 * the counted rides only (`shared/railCounting.ts`: completed).
 *
 * Two rules carry the section:
 *
 *  - **A distance says what it measures.** Kilometres are summed per source —
 *    straight line (great circle, which understates the track by 10-30 %), the
 *    traced Transitous line, or the ticket's figure — and never presented as
 *    one undifferentiated "km by train" (owner decision 7). A ride with no
 *    distance at all is counted as such, not as zero kilometres.
 *  - **Abstention is a result.** Hours on board need both instants; a delay
 *    needs a recorded delay. Rides without them leave the sample and the
 *    sample size is reported with the figure, so "on time" never includes
 *    "nobody wrote it down".
 */

const TOP = 10;
/** Upper bounds, in minutes, of the delay buckets; the last is open-ended. */
const DELAY_BUCKETS = [0, 5, 15, 30, 60] as const;

export interface RailStatsRow extends DatedRail {
  id: string;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  depStationName: string;
  arrStationName: string;
  depStationCode: string | null;
  arrStationCode: string | null;
  depCountry: string | null;
  arrCountry: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  delayMinutes: number | null;
  /** Optional only so hand-built rows in tests need not name it; the query selects it. */
  travelClass?: string | null;
  /**
   * ADR 0002 precision of each end; `day` = logged date-only (forgejo#132
   * item 17). Optional for hand-built test rows; absent reads as a clock.
   */
  depPrecision?: string | null;
  arrPrecision?: string | null;
  /** The grouping's inputs (forgejo#261); optional for hand-built test rows. */
  bookingId?: string | null;
  depStationId?: number | null;
  arrStationId?: number | null;
  depLat?: number;
  depLon?: number;
  arrLat?: number;
  arrLon?: number;
}

export interface Ranked {
  label: string;
  count: number;
}

export interface RailStats {
  journeys: number;
  distance: {
    totalKm: number;
    /** great_circle */
    straightLineKm: number;
    /** route — along the traced Transitous line */
    tracedKm: number;
    /** roadtrip — along the line a converted roadtrip leg brought */
    roadtripKm: number;
    /** user — typed from the ticket */
    ticketKm: number;
    /** Rides with no distance at all — out of every km figure. */
    unmeasuredJourneys: number;
  };
  hoursOnBoard: { hours: number; measuredJourneys: number };
  countries: string[];
  operators: Ranked[];
  trainCategories: Ranked[];
  stations: Ranked[];
  longest: {
    id: string;
    depStationName: string;
    arrStationName: string;
    distanceKm: number;
    distanceSource: string | null;
  } | null;
  delays: {
    recordedJourneys: number;
    /** One count per bucket: <= 0 (on time), <= 5, <= 15, <= 30, <= 60, > 60. */
    buckets: Array<{ upToMinutes: number | null; count: number }>;
    /**
     * Mean delay over `recordedJourneys`, one decimal, early arrivals counted
     * as the negative figures they are — the rule flight punctuality uses
     * (`services/punctualityStats.ts`). NULL when no ride carries a delay: a
     * 0 there would say "always on time" about rides nobody timed, which is
     * the confusion the bucket split already refuses.
     */
    averageMinutes: number | null;
  };
  byYear: Array<{ year: number; journeys: number; km: number }>;
  /**
   * Rides of a kind, by the rule the rail badges count them with
   * (`shared/railRideKinds.ts` via `railRideFacts`), and the number of
   * distinct operators (spelling folded) — so this tab and the badges never
   * disagree about how many night trains there were.
   */
  rideKinds: { nightTrains: number; highSpeed: number; crossBorder: number; operators: number };
  /** Journeys, changes, connections, punctuality, nights on board (forgejo#261). */
  connected: RailJourneyFigures;
}

function rank(values: Array<string | null>): Ranked[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const label = v?.trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP);
}

/** A station by its code when it has one, else by its name — the same station twice is one. */
function stationVisits(rows: readonly RailStatsRow[]): Ranked[] {
  const byKey = new Map<string, Ranked>();
  for (const r of rows) {
    for (const [code, name] of [
      [r.depStationCode, r.depStationName],
      [r.arrStationCode, r.arrStationName],
    ] as const) {
      // One station identity for the ranking and the connections (forgejo#261).
      const key = railStationKey({ code, name }) ?? `name:${name}`;
      const entry = byKey.get(key) ?? { label: name, count: 0 };
      byKey.set(key, { ...entry, count: entry.count + 1 });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP);
}

/** Both ends timed — a date-only ride has no hours on board and no delay. */
const clocked = (r: RailStatsRow): boolean =>
  rideHasClocks({ depPrecision: r.depPrecision ?? null, arrPrecision: r.arrPrecision ?? null });

function delayBuckets(rows: readonly RailStatsRow[]): RailStats["delays"] {
  const recorded = rows.filter((r) => r.delayMinutes !== null && clocked(r));
  const buckets = [...DELAY_BUCKETS, null].map((upTo, i) => {
    const lower = i === 0 ? -Infinity : DELAY_BUCKETS[i - 1];
    const count = recorded.filter((r) => {
      const d = r.delayMinutes as number;
      return d > lower && (upTo === null || d <= upTo);
    }).length;
    return { upToMinutes: upTo, count };
  });
  const averageMinutes =
    recorded.length === 0
      ? null
      : Math.round(
          (recorded.reduce((sum, r) => sum + (r.delayMinutes as number), 0) / recorded.length) * 10
        ) / 10;
  return { recordedJourneys: recorded.length, buckets, averageMinutes };
}

function rideKinds(rows: readonly RailStatsRow[]): RailStats["rideKinds"] {
  const facts = rows.map((r) =>
    railRideFacts({
      ...r,
      travelClass: r.travelClass ?? null,
      depPrecision: r.depPrecision ?? null,
      arrPrecision: r.arrPrecision ?? null,
    })
  );
  return {
    nightTrains: facts.filter((f) => f.isNightTrain).length,
    highSpeed: facts.filter((f) => f.isHighSpeed).length,
    crossBorder: facts.filter((f) => f.isCrossBorder).length,
    operators: new Set(facts.flatMap((f) => (f.operator ? [f.operator] : []))).size,
  };
}

/**
 * @param all every counted ride, for the one figure a period cut cannot answer
 *            alone: whether a connection was NEW in that period.
 */
export function computeRailStats(
  rows: readonly RailStatsRow[],
  all: readonly RailStatsRow[] = rows
): RailStats {
  const sumKm = (source: string): number =>
    rows
      .filter((r) => r.distanceSource === source && r.distanceKm !== null)
      .reduce((sum, r) => sum + (r.distanceKm as number), 0);
  const measured = rows.filter((r) => r.distanceKm !== null);
  const timed = rows.filter(
    (r) =>
      r.arrivalTime !== null && clocked(r) && r.arrivalTime.getTime() >= r.departureTime.getTime()
  );
  const longest = measured.reduce<RailStatsRow | null>(
    (best, r) =>
      best === null || (r.distanceKm as number) > (best.distanceKm as number) ? r : best,
    null
  );
  const years = new Map<number, { journeys: number; km: number }>();
  for (const r of rows) {
    const year = railYear(r);
    const entry = years.get(year) ?? { journeys: 0, km: 0 };
    years.set(year, { journeys: entry.journeys + 1, km: entry.km + (r.distanceKm ?? 0) });
  }

  return {
    journeys: rows.length,
    distance: {
      totalKm: measured.reduce((sum, r) => sum + (r.distanceKm as number), 0),
      straightLineKm: sumKm("great_circle"),
      tracedKm: sumKm("route"),
      roadtripKm: sumKm("roadtrip"),
      ticketKm: sumKm("user"),
      unmeasuredJourneys: rows.length - measured.length,
    },
    hoursOnBoard: {
      hours:
        timed.reduce(
          (sum, r) => sum + ((r.arrivalTime as Date).getTime() - r.departureTime.getTime()),
          0
        ) / 3_600_000,
      measuredJourneys: timed.length,
    },
    countries: [...new Set(rows.flatMap(railCountries))].sort(),
    operators: rank(rows.map((r) => r.operator)),
    trainCategories: rank(rows.map((r) => r.trainCategory)),
    stations: stationVisits(rows),
    longest: longest
      ? {
          id: longest.id,
          depStationName: longest.depStationName,
          arrStationName: longest.arrStationName,
          distanceKm: longest.distanceKm as number,
          distanceSource: longest.distanceSource,
        }
      : null,
    delays: delayBuckets(rows),
    byYear: [...years.entries()]
      .map(([year, v]) => ({ year, ...v }))
      .sort((a, b) => a.year - b.year),
    rideKinds: rideKinds(rows),
    connected: computeRailJourneyFigures(rows.map(withDefaults), all.map(withDefaults)),
  };
}

/** The night rule reads class and precision; a hand-built row may leave them out. */
const withDefaults = (r: RailStatsRow) => ({
  ...r,
  travelClass: r.travelClass ?? null,
  depPrecision: r.depPrecision ?? null,
  arrPrecision: r.arrPrecision ?? null,
});

const STATS_SELECT = {
  id: true,
  operator: true,
  trainCategory: true,
  trainNumber: true,
  depStationName: true,
  arrStationName: true,
  depStationCode: true,
  arrStationCode: true,
  depCountry: true,
  arrCountry: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  distanceKm: true,
  distanceSource: true,
  delayMinutes: true,
  travelClass: true,
  depPrecision: true,
  arrPrecision: true,
  bookingId: true,
  depStationId: true,
  arrStationId: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
} as const;

/**
 * The user's counted rides, optionally for the year they LEFT in on their
 * station's calendar. Loaded whole and filtered in code, because that year is
 * derived per row and cannot be pushed into the query; the set is one user's
 * train rides, and the select leaves out the frozen line.
 */
export async function loadRailStats(
  userId: string,
  year: number | null,
  /** "MM-DD": count that year only up to this day, on the departure station's calendar. */
  until: string | null = null
): Promise<RailStats> {
  const rows = await prisma.railJourney.findMany({
    where: { userId, ...countableRailWhere() },
    select: STATS_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
  if (year === null) return computeRailStats(rows);
  const lastDay = until === null ? null : `${year}-${until}`;
  return computeRailStats(
    rows.filter(
      (r) =>
        railYear(r) === year &&
        (lastDay === null || stationDayKey(r.departureTime, r.depTimezone) <= lastDay)
    ),
    rows
  );
}
