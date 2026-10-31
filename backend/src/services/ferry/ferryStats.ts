import { prisma } from "../../db";
import { countableFerryWhere, ferryCountries, ferryYear } from "../../shared/ferryCounting";
import { rideHoursOnBoard } from "../../shared/railClock";
import { operatorKey } from "../../shared/railRideKinds";
import { localDay } from "../../shared/time/instant";
import { longestRide } from "../rail/railStats";

/**
 * The ferry statistics (companion#85), the sibling of `bus/busStats.ts` over
 * the crossings `shared/ferryCounting.ts` counts: completed only, each filed
 * under the year it LEFT on its departure port's calendar.
 *
 * Same rules as bus, one stricter: **abstention is a result.** Where bus
 * reports 0 km for "nothing measured", the ferry totals are null — a client
 * must be able to tell "no distance known" from "0 km sailed". Kilometres per
 * source, hours on board only over crossings with both clocks, and the sample
 * size travels with each figure.
 */

const TOP = 10;

export interface FerryStatsRow {
  id: string;
  operator: string | null;
  depStationName: string;
  arrStationName: string;
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
}

export interface FerryRanked {
  label: string;
  count: number;
}

export interface FerryStats {
  crossings: number;
  distance: {
    /** Null when no crossing has a distance. */
    totalKm: number | null;
    straightLineKm: number | null;
    routeKm: number | null;
    ticketKm: number | null;
    unmeasuredCrossings: number;
  };
  /** `hours` null when no crossing carries both clocks. */
  hoursOnBoard: { hours: number | null; measuredCrossings: number };
  countries: string[];
  operators: FerryRanked[];
  /** Departures plus arrivals per port (by name), top ten. */
  ports: FerryRanked[];
  portsVisited: number;
  longest: {
    id: string;
    depStationName: string;
    arrStationName: string;
    distanceKm: number;
    distanceSource: string | null;
  } | null;
  byYear: Array<{ year: number; crossings: number; km: number | null; unmeasured: number }>;
}

const rank = (counts: Map<string, number>): FerryRanked[] =>
  [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP);

/** Sum of the measured values, or null when there are none (never 0 for "unknown"). */
const sumOrNull = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0);

export function computeFerryStats(rows: readonly FerryStatsRow[]): FerryStats {
  const measured = rows.filter((r) => r.distanceKm !== null);
  const bySource = (source: string): number | null =>
    sumOrNull(
      measured.filter((r) => r.distanceSource === source).map((r) => r.distanceKm as number)
    );
  const hours = rows.map(rideHoursOnBoard).filter((h): h is number => h !== null);

  const operatorLabels = new Map<string, string>();
  const operators = new Map<string, number>();
  const ports = new Map<string, { label: string; count: number }>();
  const years = new Map<number, { crossings: number; km: number | null; unmeasured: number }>();
  for (const r of rows) {
    const key = operatorKey(r.operator);
    if (key !== null) {
      if (!operatorLabels.has(key)) operatorLabels.set(key, (r.operator as string).trim());
      const label = operatorLabels.get(key)!;
      operators.set(label, (operators.get(label) ?? 0) + 1);
    }
    for (const name of [r.depStationName, r.arrStationName]) {
      const portKey = name.trim().toLowerCase();
      if (!portKey) continue;
      const entry = ports.get(portKey);
      ports.set(portKey, { label: entry?.label ?? name.trim(), count: (entry?.count ?? 0) + 1 });
    }
    const year = ferryYear(r);
    const y = years.get(year) ?? { crossings: 0, km: null, unmeasured: 0 };
    years.set(year, {
      crossings: y.crossings + 1,
      km: r.distanceKm === null ? y.km : (y.km ?? 0) + r.distanceKm,
      unmeasured: y.unmeasured + (r.distanceKm === null ? 1 : 0),
    });
  }
  const longest = longestRide(rows);

  return {
    crossings: rows.length,
    distance: {
      totalKm: sumOrNull(measured.map((r) => r.distanceKm as number)),
      straightLineKm: bySource("great_circle"),
      routeKm: bySource("route"),
      ticketKm: bySource("user"),
      unmeasuredCrossings: rows.length - measured.length,
    },
    hoursOnBoard: { hours: sumOrNull(hours), measuredCrossings: hours.length },
    countries: [...new Set(rows.flatMap(ferryCountries))].sort(),
    operators: rank(operators),
    ports: rank(new Map([...ports.values()].map((p) => [p.label, p.count]))),
    portsVisited: ports.size,
    longest: longest
      ? {
          id: longest.id,
          depStationName: longest.depStationName,
          arrStationName: longest.arrStationName,
          distanceKm: longest.distanceKm as number,
          distanceSource: longest.distanceSource,
        }
      : null,
    byYear: [...years.entries()]
      .map(([year, v]) => ({ year, ...v }))
      .sort((a, b) => a.year - b.year),
  };
}

export const FERRY_STATS_SELECT = {
  id: true,
  operator: true,
  depStationName: true,
  arrStationName: true,
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
} as const;

/** A crossing is in the period when it left in `year`, up to "MM-DD" on its port's calendar. */
export function inFerryPeriod(
  r: Pick<FerryStatsRow, "departureTime" | "depTimezone" | "arrivalTime" | "arrTimezone">,
  year: number | null,
  until: string | null
): boolean {
  if (year === null) return true;
  if (ferryYear(r) !== year) return false;
  return until === null || localDay(r.departureTime, r.depTimezone ?? "UTC") <= `${year}-${until}`;
}

export async function loadFerryStats(
  userId: string,
  year: number | null,
  until: string | null = null
): Promise<FerryStats> {
  const rows = await prisma.ferryJourney.findMany({
    where: { userId, ...countableFerryWhere() },
    select: FERRY_STATS_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
  return computeFerryStats(rows.filter((r) => inFerryPeriod(r, year, until)));
}
