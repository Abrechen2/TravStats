/**
 * The passport: which countries somebody has been to, when, and through which
 * airports.
 *
 * Derived here rather than in each client. The Companion app draws this screen
 * already and builds it from two raw endpoints; a web page doing the same would
 * be a third copy of the same arithmetic, and the three would drift — which is
 * how one screen ends up saying five continents and another six.
 *
 * FOUR RULES, all chosen to agree with figures this server already publishes
 * elsewhere. A passport that contradicts the statistics page is worse than no
 * passport.
 *
 * 1. FLOWN ONLY. A booked flight is not a stamp. The same cut the rest of the
 *    statistics make, and the same one shared/placeCounting.ts makes for places.
 * 2. BOTH ENDS COUNT. A country counts if a flight began OR ended there, which
 *    is how airportStats counts countries. Arrivals only would drop the country
 *    somebody lives in until their first flight home.
 * 3. ONE STAMP PER AIRPORT, dated its first visit. A stamp marks having been
 *    somewhere, not how often; a commuter would otherwise paper over the card
 *    with a single airport.
 * 4. NO FORMATTED TEXT. Dates go out as dates. A month name belongs to the
 *    reader's language, and this server does not know it.
 */

import { getContinent, isoCountryCode, type Continent } from "../../utils/continents";
import { CONTINENT_GROUPS, continentTotals } from "../../shared/passportContinents";

/** The columns the derivation reads. Any flight row is a superset. */
export interface PassportFlight {
  depIata: string | null;
  depLat: number;
  depLon: number;
  arrIata: string | null;
  arrLat: number;
  arrLon: number;
  departureTime: Date | null;
  status: string;
}

/** Country per airport code, as the catalogue holds it. */
export type AirportCountries = ReadonlyMap<string, string | null>;

export interface PassportCountry {
  /** ISO-3166 alpha-2. What a client shows — never a flag: flags are political and age. */
  code: string;
  continent: Continent | null;
  /** Flights that began or ended here. See rule 2. */
  entries: number;
  firstYear: number | null;
  lastYear: number | null;
  /** The airports used here, first visit first. */
  airports: string[];
  /** A home airport of the user's is in this country. */
  isHome: boolean;
  /** First reached in the current calendar year. */
  isNew: boolean;
}

export interface PassportStamp {
  iata: string;
  country: string | null;
  /** First visit, ISO date. The client formats it — see rule 4. */
  date: string | null;
}

export interface Passport {
  summary: {
    countries: number;
    airports: number;
    entries: number;
    continentsVisited: number;
    continentsTotal: number;
    firstStampYear: number | null;
    newThisYear: number;
  };
  countries: PassportCountry[];
  continents: Array<{ continent: Continent; visited: number; total: number }>;
  /**
   * How the rows are drawn. Presentation only: summary.continentsVisited counts
   * real continents, so reaching Antarctica moves the number even though it
   * shares a row with Africa.
   */
  groups: typeof CONTINENT_GROUPS;
  stamps: PassportStamp[];
}

const FLOWN = new Set(["flown", "historical"]);

interface Touch {
  iata: string;
  lat: number;
  lon: number;
}

/** The two ends of a flight, as far as this derivation cares. */
const touchesOf = (f: PassportFlight): Touch[] => {
  const out: Touch[] = [];
  if (f.depIata) out.push({ iata: f.depIata, lat: f.depLat, lon: f.depLon });
  if (f.arrIata) out.push({ iata: f.arrIata, lat: f.arrLat, lon: f.arrLon });
  return out;
};

interface CountryAcc {
  entries: Set<PassportFlight>;
  /** airport code to its earliest known visit date */
  airports: Map<string, string | null>;
  firstYear: number | null;
  lastYear: number | null;
  continent: Continent | null;
  isHome: boolean;
}

export function buildPassport(
  flights: readonly PassportFlight[],
  airportCountries: AirportCountries,
  homeIatas: readonly string[] = [],
  now: Date = new Date(),
): Passport {
  const thisYear = now.getUTCFullYear();
  const home = new Set(homeIatas.map((c) => c.toUpperCase()));

  const byCountry = new Map<string, CountryAcc>();
  const firstSeen = new Map<string, { date: string | null; country: string | null }>();

  for (const flight of flights) {
    if (!FLOWN.has(flight.status)) continue;
    const year = flight.departureTime ? flight.departureTime.getUTCFullYear() : null;
    const isoDate = flight.departureTime ? flight.departureTime.toISOString().slice(0, 10) : null;

    for (const touch of touchesOf(flight)) {
      const code = touch.iata.toUpperCase();
      const country = isoCountryCode(airportCountries.get(code) ?? null);

      // An airport whose country the catalogue does not know is left out rather
      // than filed somewhere plausible. A wrong country inflates a continent
      // quota and nobody can tell by looking.
      if (!country) continue;

      const seen = firstSeen.get(code);
      if (!seen || (isoDate !== null && (seen.date === null || isoDate < seen.date))) {
        firstSeen.set(code, { date: isoDate, country });
      }

      let acc = byCountry.get(country);
      if (!acc) {
        acc = {
          entries: new Set<PassportFlight>(),
          airports: new Map<string, string | null>(),
          firstYear: null,
          lastYear: null,
          continent: getContinent(touch.lat, touch.lon, country),
          isHome: false,
        };
        byCountry.set(country, acc);
      }

      // A Set of flights, so a domestic hop counts once for its country.
      acc.entries.add(flight);

      const known = acc.airports.get(code);
      if (known === undefined || (isoDate !== null && (known === null || isoDate < known))) {
        acc.airports.set(code, isoDate);
      }

      if (year !== null) {
        acc.firstYear = acc.firstYear === null ? year : Math.min(acc.firstYear, year);
        acc.lastYear = acc.lastYear === null ? year : Math.max(acc.lastYear, year);
      }
      if (home.has(code)) acc.isHome = true;
    }
  }

  const countries: PassportCountry[] = [...byCountry.entries()]
    .map(([code, acc]) => ({
      code,
      continent: acc.continent,
      entries: acc.entries.size,
      firstYear: acc.firstYear,
      lastYear: acc.lastYear,
      airports: [...acc.airports.entries()]
        .sort(
          (a, b) =>
            (a[1] ?? "9999-99-99").localeCompare(b[1] ?? "9999-99-99") ||
            a[0].localeCompare(b[0]),
        )
        .map(([iata]) => iata),
      isHome: acc.isHome,
      isNew: acc.firstYear === thisYear,
    }))
    .sort((a, b) => b.entries - a.entries || a.code.localeCompare(b.code));

  const totals = continentTotals();
  const visitedPerContinent = new Map<Continent, number>();
  for (const row of countries) {
    if (!row.continent) continue;
    visitedPerContinent.set(row.continent, (visitedPerContinent.get(row.continent) ?? 0) + 1);
  }

  const stamps: PassportStamp[] = [...firstSeen.entries()]
    .map(([iata, seen]) => ({ iata, country: seen.country, date: seen.date }))
    .sort(
      (a, b) =>
        (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99") ||
        a.iata.localeCompare(b.iata),
    );

  const firstYears = countries
    .map((c) => c.firstYear)
    .filter((y): y is number => y !== null);

  return {
    summary: {
      countries: countries.length,
      airports: firstSeen.size,
      entries: countries.reduce((sum, c) => sum + c.entries, 0),
      continentsVisited: visitedPerContinent.size,
      continentsTotal: Object.keys(totals).length,
      firstStampYear: firstYears.length > 0 ? Math.min(...firstYears) : null,
      newThisYear: countries.filter((c) => c.isNew).length,
    },
    countries,
    continents: (Object.keys(totals) as Continent[])
      .map((continent) => ({
        continent,
        visited: visitedPerContinent.get(continent) ?? 0,
        total: totals[continent],
      }))
      .sort((a, b) => b.visited - a.visited || a.continent.localeCompare(b.continent)),
    groups: CONTINENT_GROUPS,
    stamps,
  };
}
