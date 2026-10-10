import { calculateDistance } from "../geo";
import { getCachedAirports } from "../../services/airportCache";
import logger from "../logger";
import type { AirportData } from "../../services/airportLookup";
import type { FlightData } from "./types";
import { departureClockOf } from "./departureClock";
import { type HomePeriod, isHomeAirportAt, primaryAirportAt, residenceAt } from "../homeAirport";
import { isCountableFlight } from "../../shared/flightCounting";
import { CONTINENTS, getContinent } from "../continents";

// Published by /stats/airports, so the shape is described once in
// `schemas/statsFlights.ts` and read here (forgejo#52). The prose that used to
// sit on these fields moved with them, where a consumer of the spec can see it.
import type { AirportStats } from "../../schemas/statsFlights";
export type { AirportStats };

/**
 * The continent an airport lies on, through the one shared resolver.
 *
 * This file used to carry its own six-bucket country table with no
 * Antarctica and 'Other' for everything it did not list — the third copy of
 * a rule `utils/continents.ts` was written to end. A flight to McMurdo
 * counted as 'Other', and Bermuda pushed the tile to "7 of 6".
 */
function continentOfAirport(info: AirportData | undefined): string {
  if (!info) return "Other";
  return getContinent(info.lat, info.lon, info.country) ?? "Other";
}

function emptyAirportStats(): AirportStats {
  return {
    airportCount: 0,
    countryCount: 0,
    continentCount: 0,
    continentTotal: CONTINENTS.length,
    topAirports: [],
    rarestAirports: [],
    newThisYear: [],
    farthestFromHome: null,
    topCountries: [],
    continentDistribution: {},
  };
}

/**
 * Calculate airport-focused statistics. Takes the same flight list used by
 * calculateUniqueStats and the user's home airport history (for the
 * farthest-from-home computation).
 *
 * All metrics here are time-insensitive (airport counts, country/continent
 * coverage, great-circle distance), so we count both `flown` and
 * `historical` flights.
 */
export async function calculateAirportStats(
  flights: FlightData[],
  homePeriods: readonly HomePeriod[] = []
): Promise<AirportStats> {
  const flownFlights = flights.filter(isCountableFlight);
  if (flownFlights.length === 0) return emptyAirportStats();

  // Collect airport codes to look up names and countries in one batched call.
  const codes = new Set<string>();
  for (const f of flownFlights) {
    if (f.depIata) codes.add(f.depIata);
    if (f.depIcao && !f.depIata) codes.add(f.depIcao);
    if (f.arrIata) codes.add(f.arrIata);
    if (f.arrIcao && !f.arrIata) codes.add(f.arrIcao);
  }

  let airportInfo: Map<string, AirportData> = new Map();
  try {
    airportInfo = await getCachedAirports(Array.from(codes));
  } catch (error) {
    logger.error({
      operation: "calculate_airport_stats",
      message: "Failed to fetch airport metadata, returning partial stats",
      error,
    });
  }

  // visits: airport code → count (both arrivals and departures)
  const visits = new Map<string, number>();
  // firstVisitDate: airport code → earliest departure or arrival date (YYYY-MM-DD)
  const firstVisit = new Map<string, string>();
  // countryCount: country code → flight count (counts each flight once per
  // country it touches; international flights contribute to two countries).
  const countryCount = new Map<string, number>();
  // continentCount: continent → flight count (same counting scheme).
  const continentCount = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) || 0) + 1);
  };

  for (const f of flownFlights) {
    const dep = f.depIata || f.depIcao;
    const arr = f.arrIata || f.arrIcao;
    if (dep) bump(visits, dep);
    if (arr) bump(visits, arr);

    // Track first visit dates using the earliest known timestamp per airport,
    // read on the clock at the departure airport rather than in UTC (#266).
    const dayIso = departureClockOf(f)?.date ?? null;
    if (dayIso) {
      for (const code of [dep, arr]) {
        if (!code) continue;
        const prev = firstVisit.get(code);
        if (!prev || dayIso < prev) firstVisit.set(code, dayIso);
      }
    }

    const depCountry = dep ? (airportInfo.get(dep)?.country ?? null) : null;
    const arrCountry = arr ? (airportInfo.get(arr)?.country ?? null) : null;
    if (depCountry) bump(countryCount, depCountry);
    if (arrCountry && arrCountry !== depCountry) bump(countryCount, arrCountry);

    const depContinent = continentOfAirport(dep ? airportInfo.get(dep) : undefined);
    const arrContinent = continentOfAirport(arr ? airportInfo.get(arr) : undefined);
    bump(continentCount, depContinent);
    if (arrContinent !== depContinent) bump(continentCount, arrContinent);
  }

  // Top airports by visits, descending. Cap at 5 for the UI.
  const topAirports = Array.from(visits.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([code, count]) => ({
      code,
      name: airportInfo.get(code)?.name ?? null,
      country: airportInfo.get(code)?.country ?? null,
      visits: count,
    }));

  // Rarest airports — visited exactly once. Cap at 5 to keep payload small.
  const rarestAirports = Array.from(visits.entries())
    .filter(([, count]) => count === 1)
    .slice(0, 5)
    .map(([code]) => ({
      code,
      name: airportInfo.get(code)?.name ?? null,
      country: airportInfo.get(code)?.country ?? null,
    }));

  // New this year — airports whose first visit falls in the current year.
  const currentYear = new Date().getUTCFullYear();
  const newThisYear = Array.from(firstVisit.entries())
    .filter(([, date]) => date.startsWith(`${currentYear}-`))
    .sort(([, a], [, b]) => (a < b ? -1 : 1))
    .map(([code, date]) => ({
      code,
      name: airportInfo.get(code)?.name ?? null,
      country: airportInfo.get(code)?.country ?? null,
      firstVisitDate: date,
    }));

  const farthest = farthestFromHomeOf(flownFlights, homePeriods);
  const farthestFromHome: AirportStats["farthestFromHome"] = farthest && {
    code: farthest.code,
    name: airportInfo.get(farthest.code)?.name ?? null,
    country: airportInfo.get(farthest.code)?.country ?? null,
    distanceKm: farthest.distanceKm,
    homeCode: farthest.homeCode,
  };

  const topCountries = Array.from(countryCount.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

  const continentDistribution: Record<string, number> = {};
  for (const [k, v] of continentCount.entries()) continentDistribution[k] = v;

  return {
    airportCount: visits.size,
    countryCount: countryCount.size,
    // "Other" is the fallback for a country the table does not list — it is
    // the ABSENCE of a continent, not a seventh one. Counting it let a flight
    // to Bermuda or Curaçao push the tile to "7 of 6".
    continentCount: [...continentCount.keys()].filter((c) => c !== "Other").length,
    continentTotal: CONTINENTS.length,
    topAirports,
    rarestAirports,
    newThisYear,
    farthestFromHome,
    topCountries,
    continentDistribution,
  };
}

/**
 * Farthest from home — every arrival that isn't a home airport, measured
 * great-circle from where the user LIVED at that time (the residence; for an
 * unconfirmed migrated period that is the old airport, so the number is the
 * one it always was). The first arrival to reach the maximum wins; its flight
 * is the witness the evidence panel lists (forgejo#256).
 */
export function farthestFromHomeOf(
  flights: readonly FlightData[],
  homePeriods: readonly HomePeriod[]
): { code: string; distanceKm: number; homeCode: string; flightId: string } | null {
  let best: { code: string; distance: number; homeCode: string; flightId: string } | null = null;
  for (const f of flights) {
    const arrCode = f.arrIata || f.arrIcao;
    if (!arrCode) continue;
    const flightDay = departureClockOf(f)?.date ?? new Date().toISOString().slice(0, 10);
    const homeCode = primaryAirportAt(homePeriods, flightDay);
    const residence = residenceAt(homePeriods, flightDay);
    if (!homeCode || !residence) continue;
    if (isHomeAirportAt(homePeriods, flightDay, arrCode)) continue;
    const distance = calculateDistance(residence.lat, residence.lon, f.arrLat, f.arrLon);
    // Against the ROUNDED leader, as the tile always compared.
    if (!best || distance > Math.round(best.distance)) {
      best = { code: arrCode, distance, homeCode, flightId: f.id };
    }
  }
  return (
    best && {
      code: best.code,
      distanceKm: Math.round(best.distance),
      homeCode: best.homeCode,
      flightId: best.flightId,
    }
  );
}
