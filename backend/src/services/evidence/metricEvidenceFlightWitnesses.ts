import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightSumEvidence, requireAllTime, type FlightRowIdentity } from "./flightMeasureResponse";
import { loadCountableCoordinateRows } from "./flightPopulations";
import { loadStatsPageRows } from "../stats/pageRows";
import { loadHomePeriods } from "../home/homeStore";
import { loadRecordFlights, travelRecordWitnesses } from "../stats/records";
import { analyseFunStats, type FunWitnesses } from "../../utils/stats/funStats";
import { analyseUniqueStats, type UniqueWitnesses } from "../../utils/stats/uniqueStats";
import { farthestFromHomeOf } from "../../utils/stats/airportStats";
import { isCountableFlight } from "../../shared/flightCounting";
import { haversineKm } from "../../shared/geo/haversine";
import { flightDurationOf, type TimedFlightRow } from "../../shared/flightDuration";
import type { TravelRecord } from "../../schemas/statsDomains";
import type { FlightTimeSemantics } from "../../utils/timezone";

/**
 * The flights behind the flight tab's "most" figures (forgejo#256) — see
 * `shared/evidenceMeasuresFlightWitnesses.ts` for why each is a `sum` of
 * flights rather than the extreme itself.
 *
 * Every resolver runs the calculator the tile's number came from over the
 * rows its endpoint loads, and lists the witnesses THAT calculation chose: a
 * tie is settled by the calculator's own rule, never re-decided here.
 */

type Resolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

interface WitnessRow {
  id: string;
  departureTime: Date | null;
  depTimezone?: string | null;
  depTimeSemantics?: string;
}

const asIdentity = (row: WitnessRow): FlightRowIdentity => ({
  id: row.id,
  departureTime: row.departureTime,
  depTimezone: row.depTimezone ?? null,
  depTimeSemantics: (row.depTimeSemantics ?? "UNKNOWN") as FlightTimeSemantics,
});

function listed(
  key: string,
  load: (userId: string) => Promise<{ rows: readonly WitnessRow[]; ids: readonly string[] }>
): Resolver {
  return async (userId, scope, page) => {
    requireAllTime(scope, key);
    const { rows, ids } = await load(userId);
    const wanted = new Set(ids);
    return flightSumEvidence({
      userId,
      key,
      unit: "flights",
      scope,
      page,
      rows: rows.filter((r) => wanted.has(r.id)).map(asIdentity),
    });
  };
}

const RECORD_KEYS: Record<string, TravelRecord["id"]> = {
  recordLongestFlight: "longest-flight",
  recordShortestFlight: "shortest-flight",
  recordBusiestDay: "busiest-day",
  recordLongestAloft: "longest-aloft",
  recordBiggestDelay: "biggest-delay",
  recordNorthernmost: "northernmost",
  recordLongestStreak: "longest-streak",
};

const recordResolver = (key: string, id: TravelRecord["id"]): Resolver =>
  listed(key, async (userId) => {
    const rows = await loadRecordFlights(userId);
    return { rows, ids: travelRecordWitnesses(rows)[id] ?? [] };
  });

const funResolver = (key: string, pick: keyof FunWitnesses): Resolver =>
  listed(key, async (userId) => {
    const rows = await loadStatsPageRows(userId);
    return { rows, ids: (await analyseFunStats(rows)).witnesses[pick] };
  });

const uniqueResolver = (key: string, pick: keyof UniqueWitnesses): Resolver =>
  listed(key, async (userId) => {
    const [rows, homePeriods] = await Promise.all([
      loadStatsPageRows(userId),
      loadHomePeriods(userId),
    ]);
    return { rows, ids: (await analyseUniqueStats(rows, homePeriods)).witnesses[pick] };
  });

/**
 * Longest / shortest great-circle leg over the countable flights — the
 * distance section's own fold, which the page runs on the client over the
 * same flights and coordinates. A zero-length leg cannot be the shortest.
 * Every flight at the extreme is listed: equal legs are the same figure.
 */
const distanceResolver = (key: string, direction: "longest" | "shortest"): Resolver =>
  listed(key, async (userId) => {
    const rows = (await loadCountableCoordinateRows(userId)).map((r) => ({
      row: r,
      km: haversineKm({ lat: r.depLat, lon: r.depLon }, { lat: r.arrLat, lon: r.arrLon }),
    }));
    const measured = rows.filter((r) => r.km > 0);
    if (measured.length === 0) return { rows: [], ids: [] };
    const kms = measured.map((r) => r.km);
    const extreme = direction === "longest" ? Math.max(...kms) : Math.min(...kms);
    return {
      rows: measured.map((r) => r.row),
      ids: measured.filter((r) => r.km === extreme).map((r) => r.row.id),
    };
  });

/**
 * Longest / shortest flight by DURATION — the breakdown's own rule: the
 * enriched `durationMinutes` (the record loader's, clocks through their zones)
 * where it is positive, else `flightDurationOf` (measured, else estimated from
 * the coordinates), the same order the page applies. Every flight at the
 * extreme is listed.
 */
const durationResolver = (key: string, direction: "longest" | "shortest"): Resolver =>
  listed(key, async (userId) => {
    const rows = await loadRecordFlights(userId);
    const timed = rows
      .map((row) => {
        const own = row.durationMinutes;
        const minutes =
          typeof own === "number" && own > 0
            ? own
            : (flightDurationOf(row as unknown as TimedFlightRow)?.minutes ?? null);
        return { row, minutes };
      })
      .filter((r): r is { row: (typeof rows)[number]; minutes: number } => (r.minutes ?? 0) > 0);
    if (timed.length === 0) return { rows: [], ids: [] };
    const all = timed.map((r) => r.minutes);
    const extreme = direction === "longest" ? Math.max(...all) : Math.min(...all);
    return { rows, ids: timed.filter((r) => r.minutes === extreme).map((r) => r.row.id) };
  });

const farthestFromHome: Resolver = listed("farthestFromHomeFlights", async (userId) => {
  const [rows, homePeriods] = await Promise.all([
    loadStatsPageRows(userId),
    loadHomePeriods(userId),
  ]);
  const found = farthestFromHomeOf(rows.filter(isCountableFlight), homePeriods);
  return { rows, ids: found ? [found.flightId] : [] };
});

/** Every witness key, bound to its resolver — spread into `METRIC_RESOLVERS`. */
export const FLIGHT_WITNESS_RESOLVERS: Record<string, Resolver> = {
  ...Object.fromEntries(
    Object.entries(RECORD_KEYS).map(([key, id]) => [key, recordResolver(key, id)])
  ),
  longestDistanceFlights: distanceResolver("longestDistanceFlights", "longest"),
  shortestDistanceFlights: distanceResolver("shortestDistanceFlights", "shortest"),
  loyaltyAirlineFlights: funResolver("loyaltyAirlineFlights", "loyaltyAirline"),
  busiestDayFlights: funResolver("busiestDayFlights", "busiestDay"),
  milestoneYearFlights: funResolver("milestoneYearFlights", "milestoneYear"),
  routeMasterFlights: funResolver("routeMasterFlights", "routeMaster"),
  seasonFlights: uniqueResolver("seasonFlights", "seasons"),
  highestAirportFlights: uniqueResolver("highestAirportFlights", "highestAirport"),
  northernmostFlights: uniqueResolver("northernmostFlights", "northernmost"),
  southernmostFlights: uniqueResolver("southernmostFlights", "southernmost"),
  travelChainFlights: uniqueResolver("travelChainFlights", "longestTravelChain"),
  fastestRouteFlights: uniqueResolver("fastestRouteFlights", "fastestRoute"),
  mostCountriesDayFlights: uniqueResolver("mostCountriesDayFlights", "mostCountriesInDay"),
  longestLayoverFlights: uniqueResolver("longestLayoverFlights", "longestLayover"),
  shortestLayoverFlights: uniqueResolver("shortestLayoverFlights", "shortestLayover"),
  farthestFromHomeFlights: farthestFromHome,
  longestDurationFlights: durationResolver("longestDurationFlights", "longest"),
  shortestDurationFlights: durationResolver("shortestDurationFlights", "shortest"),
};
