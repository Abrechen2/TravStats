import { calculateDistance } from '../geo';
import { getCachedAirports } from '../../services/airportCache';
import logger from '../logger';
import type { AirportData } from '../../services/airportLookup';
import type { FlightData } from './types';
import { departureClockOf } from './departureClock';
import { HomeAirportEntry, getHomeAirportAt } from '../homeAirport';

export interface AirportStats {
  /** Distinct airports the user has ever used (as departure or arrival). */
  airportCount: number;
  /** Distinct countries visited (based on dep+arr countries). */
  countryCount: number;
  /** Distinct continents covered. */
  continentCount: number;
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
  /** Flights per continent (continent derived from country code). */
  continentDistribution: Record<string, number>;
}

function emptyAirportStats(): AirportStats {
  return {
    airportCount: 0,
    countryCount: 0,
    continentCount: 0,
    topAirports: [],
    rarestAirports: [],
    newThisYear: [],
    farthestFromHome: null,
    topCountries: [],
    continentDistribution: {},
  };
}

// Small, approximate country-to-continent map. Covers the common cases; an
// unknown country falls into "Other" rather than being dropped so the user
// still sees 100% of their flights accounted for.
const CONTINENT_BY_COUNTRY: Record<string, string> = {
  // Europe (partial — enough for usual travel)
  DE: 'EU', AT: 'EU', CH: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', PT: 'EU', NL: 'EU',
  BE: 'EU', LU: 'EU', DK: 'EU', SE: 'EU', NO: 'EU', FI: 'EU', IS: 'EU', IE: 'EU',
  GB: 'EU', UK: 'EU', PL: 'EU', CZ: 'EU', SK: 'EU', HU: 'EU', RO: 'EU', BG: 'EU',
  GR: 'EU', HR: 'EU', SI: 'EU', RS: 'EU', BA: 'EU', MK: 'EU', AL: 'EU', ME: 'EU',
  EE: 'EU', LV: 'EU', LT: 'EU', BY: 'EU', UA: 'EU', MD: 'EU', MT: 'EU', CY: 'EU',
  XK: 'EU', VA: 'EU', SM: 'EU', MC: 'EU', LI: 'EU', AD: 'EU', FO: 'EU',
  // North America
  US: 'NA', CA: 'NA', MX: 'NA', CU: 'NA', JM: 'NA', DO: 'NA', HT: 'NA', BS: 'NA',
  PR: 'NA', GT: 'NA', HN: 'NA', SV: 'NA', NI: 'NA', CR: 'NA', PA: 'NA', BZ: 'NA',
  TT: 'NA', BB: 'NA', GL: 'NA',
  // South America
  BR: 'SA', AR: 'SA', CL: 'SA', PE: 'SA', CO: 'SA', VE: 'SA', EC: 'SA', BO: 'SA',
  PY: 'SA', UY: 'SA', GY: 'SA', SR: 'SA', GF: 'SA',
  // Asia
  CN: 'AS', JP: 'AS', KR: 'AS', KP: 'AS', TW: 'AS', HK: 'AS', MO: 'AS', MN: 'AS',
  IN: 'AS', PK: 'AS', BD: 'AS', LK: 'AS', NP: 'AS', BT: 'AS', MV: 'AS', AF: 'AS',
  ID: 'AS', PH: 'AS', VN: 'AS', TH: 'AS', MY: 'AS', SG: 'AS', KH: 'AS', LA: 'AS',
  MM: 'AS', BN: 'AS', TL: 'AS',
  AE: 'AS', SA: 'AS', QA: 'AS', BH: 'AS', KW: 'AS', OM: 'AS', YE: 'AS', IL: 'AS',
  JO: 'AS', LB: 'AS', SY: 'AS', IQ: 'AS', IR: 'AS', TR: 'AS',
  KZ: 'AS', UZ: 'AS', TM: 'AS', KG: 'AS', TJ: 'AS', AZ: 'AS', AM: 'AS', GE: 'AS',
  RU: 'AS', // lumped with Asia for simplicity; could split by region later.
  // Africa
  ZA: 'AF', EG: 'AF', MA: 'AF', DZ: 'AF', TN: 'AF', LY: 'AF', SD: 'AF', ET: 'AF',
  KE: 'AF', TZ: 'AF', UG: 'AF', RW: 'AF', BI: 'AF', SO: 'AF', DJ: 'AF', ER: 'AF',
  NG: 'AF', GH: 'AF', CI: 'AF', SN: 'AF', ML: 'AF', BF: 'AF', NE: 'AF', TD: 'AF',
  CM: 'AF', CF: 'AF', GA: 'AF', CG: 'AF', CD: 'AF', AO: 'AF', ZM: 'AF', ZW: 'AF',
  BW: 'AF', NA: 'AF', MZ: 'AF', MW: 'AF', MG: 'AF', MU: 'AF', SC: 'AF', RE: 'AF',
  // Oceania
  AU: 'OC', NZ: 'OC', PG: 'OC', FJ: 'OC', SB: 'OC', VU: 'OC', NC: 'OC', PF: 'OC',
  WS: 'OC', TO: 'OC', KI: 'OC', FM: 'OC', MH: 'OC', PW: 'OC', NR: 'OC', TV: 'OC',
};

function continentOf(country: string | null | undefined): string {
  if (!country) return 'Other';
  return CONTINENT_BY_COUNTRY[country.toUpperCase()] || 'Other';
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
  const flownFlights = flights.filter(
    (f) => f.status === 'flown' || f.status === 'historical'
  );
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

    const depContinent = continentOf(depCountry);
    const arrContinent = continentOf(arrCountry);
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
    topAirports,
    rarestAirports,
    newThisYear,
    farthestFromHome,
    topCountries,
    continentDistribution,
  };
}
