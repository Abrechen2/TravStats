import { calculateDistance } from '../geo';
import { getCachedAirports } from '../../services/airportCache';
import logger from '../logger';
import type { AirportData } from '../../services/airportLookup';
import type { FlightData } from './types';
import { departureClockOf } from './departureClock';
import { HomeAirportEntry, getHomeAirportAt } from '../homeAirport';
import { isCountableFlight } from '../../shared/flightCounting';
import { CONTINENTS, getContinent } from '../continents';

export interface AirportStats {
  /** Distinct airports the user has ever used (as departure or arrival). */
  airportCount: number;
  /** Distinct countries visited (based on dep+arr countries). */
  countryCount: number;
  /** Distinct continents covered. */
  continentCount: number;
  /**
   * The denominator for `continentCount` — how many continents the shared
   * table knows (seven, Antarctica included). Sent rather than hard-coded on
   * the client: the tile printed "/ 6" for months while its own caption said
   * "of the 7" and the passport said 6/7 (forgejo#87). One source, one number.
   */
  continentTotal: number;
  /** Top airports by visit count (departure + arrival combined). */
  topAirports: Array<{ code: string; name: string | null; country: string | null; visits: number }>;
  /** Airports visited only once. Capped to keep payload small. */
  rarestAirports: Array<{ code: string; name: string | null; country: string | null }>;
  /** First-time airports in the current calendar year. */
  newThisYear: Array<{ code: string; name: string | null; country: string | null; firstVisitDate: string }>;
  /** The farthest airport from home (where "home" = home airport active at the flight's date). */
  farthestFromHome: {
    code: string;
    name: string | null;
    country: string | null;
    distanceKm: number;
    homeCode: string;
  } | null;
  /** Top visited countries by flight count. */
  topCountries: Array<{ country: string; count: number }>;
  /**
   * Flights per continent, keyed by the continent's name from
   * `utils/continents.ts` ("Europe", "Antarctica", …). "Other" holds the
   * flights whose airport resolved to no continent at all — the absence of
   * one, never a further one.
   */
  continentDistribution: Record<string, number>;
}

/**
 * The continent an airport lies on, through the one shared resolver.
 *
 * This file used to carry its own six-bucket country table with no
 * Antarctica and 'Other' for everything it did not list — the third copy of
 * a rule `utils/continents.ts` was written to end. A flight to McMurdo
 * counted as 'Other', and Bermuda pushed the tile to "7 of 6".
 */
function continentOfAirport(info: AirportData | undefined): string {
  if (!info) return 'Other';
  return getContinent(info.lat, info.lon, info.country) ?? 'Other';
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
  homeAirportHistory: HomeAirportEntry[] = []
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
      operation: 'calculate_airport_stats',
      message: 'Failed to fetch airport metadata, returning partial stats',
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

    const depCountry = dep ? airportInfo.get(dep)?.country ?? null : null;
    const arrCountry = arr ? airportInfo.get(arr)?.country ?? null : null;
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

  // Farthest from home — consider every arrival that isn't home itself and
  // measure great-circle distance to whatever home was active at that time.
  let farthestFromHome: AirportStats['farthestFromHome'] = null;
  for (const f of flownFlights) {
    const arrCode = f.arrIata || f.arrIcao;
    if (!arrCode) continue;
    const flightDay = departureClockOf(f)?.date ?? new Date().toISOString().slice(0, 10);
    const homeCode = getHomeAirportAt(homeAirportHistory, flightDay);
    if (!homeCode) continue;
    if (homeCode === arrCode) continue;

    const homeAirport = airportInfo.get(homeCode);
    if (!homeAirport) continue;

    const distance = calculateDistance(homeAirport.lat, homeAirport.lon, f.arrLat, f.arrLon);
    if (!farthestFromHome || distance > farthestFromHome.distanceKm) {
      farthestFromHome = {
        code: arrCode,
        name: airportInfo.get(arrCode)?.name ?? null,
        country: airportInfo.get(arrCode)?.country ?? null,
        distanceKm: Math.round(distance),
        homeCode,
      };
    }
  }

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
    continentCount: [...continentCount.keys()].filter((c) => c !== 'Other').length,
    continentTotal: CONTINENTS.length,
    topAirports,
    rarestAirports,
    newThisYear,
    farthestFromHome,
    topCountries,
    continentDistribution,
  };
}
