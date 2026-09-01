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
 * 5. EVIDENCE, NOT ONLY FLIGHTS (Forgejo #42, owner's decision 2026-08-31).
 *    A landing proves presence; so does a cruise that called at a port, and so
 *    does a place the user recorded visiting. The Companion already counted
 *    this way ("31 geflogen · 5 per hafen · 2 anders erreicht") while this
 *    server counted flights alone, so one account had two answers to "how many
 *    countries". Each country now carries the STRONGEST evidence behind it, so
 *    that split line comes from one implementation instead of two.
 *
 *    A port or a place joins on its resolved country code and never on free
 *    text — "Deutschland" and "Germany" are one country and only the code knows
 *    that. A place whose country was never resolved contributes NOTHING rather
 *    than a guess: shared/placeCounting.ts makes the same cut for the same
 *    reason.
 */

import {
  continentForCountry,
  getContinent,
  isoCountryCode,
  type Continent,
} from "../../utils/continents";
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

/**
 * A port a SAILED cruise actually called at. Scheduled itineraries are not
 * evidence, the same cut rule 1 makes for flights.
 */
export interface PassportPortCall {
  /** Free text as the port catalogue holds it; resolved here, never trusted raw. */
  country: string | null;
  /** When the ship was there, if known. */
  at: Date | null;
}

/** A place the user recorded visiting, with its country already resolved. */
export interface PassportPlaceVisit {
  isoCountryCode: string | null;
  at: Date | null;
}

/**
 * What put a country in the passport. Ordered: a landing outranks a port call,
 * which outranks a recorded place — the order the owner's own split line reads
 * in, and the one a row shows when several kinds apply.
 */
export type PassportEvidence = "flight" | "port" | "place";

const EVIDENCE_RANK: Record<PassportEvidence, number> = { flight: 3, port: 2, place: 1 };

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
  /** The strongest reason this country is in the passport. See rule 5. */
  evidence: PassportEvidence;
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
    /**
     * Countries per strongest evidence — the source of "31 geflogen · 5 per
     * hafen · 2 anders erreicht". Sums to `countries`.
     */
    byEvidence: Record<PassportEvidence, number>;
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
  evidence: PassportEvidence;
}

export function buildPassport(
  flights: readonly PassportFlight[],
  airportCountries: AirportCountries,
  homeIatas: readonly string[] = [],
  now: Date = new Date(),
  /** Optional so every existing caller keeps its exact behaviour. */
  portCalls: readonly PassportPortCall[] = [],
  placeVisits: readonly PassportPlaceVisit[] = []
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
          evidence: "flight",
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
      if (EVIDENCE_RANK[acc.evidence] < EVIDENCE_RANK.flight) acc.evidence = "flight";
    }
  }

  /**
   * A country reached without a landing.
   *
   * Deliberately does NOT touch `entries` or `airports`: those count flights and
   * name airports, and a port call is neither. A country proved only this way
   * shows no entries and no airports, which is honest — it is why the row
   * carries its evidence kind at all.
   *
   * `continent` falls back to the country code, since a port call carries no
   * coordinates here. `getContinent` returns null for a transcontinental
   * country rather than guessing, and null is the right answer for one.
   */
  const addNonFlight = (country: string | null, at: Date | null, kind: PassportEvidence): void => {
    if (!country) return;
    const year = at ? at.getUTCFullYear() : null;
    let acc = byCountry.get(country);
    if (!acc) {
      acc = {
        entries: new Set<PassportFlight>(),
        airports: new Map<string, string | null>(),
        firstYear: null,
        lastYear: null,
        // Country-only: a port call carries no coordinates here, and
        // `continentForCountry` answers null for a transcontinental country
        // rather than picking a side — which is the right answer for one.
        continent: continentForCountry(country),
        isHome: false,
        evidence: kind,
      };
      byCountry.set(country, acc);
    }
    if (EVIDENCE_RANK[acc.evidence] < EVIDENCE_RANK[kind]) acc.evidence = kind;
    if (year !== null) {
      acc.firstYear = acc.firstYear === null ? year : Math.min(acc.firstYear, year);
      acc.lastYear = acc.lastYear === null ? year : Math.max(acc.lastYear, year);
    }
  };

  for (const call of portCalls) addNonFlight(isoCountryCode(call.country), call.at, "port");
  // Already resolved by the caller — a place whose country was never resolved
  // contributes nothing rather than a guess.
  for (const visit of placeVisits) {
    addNonFlight(
      visit.isoCountryCode ? visit.isoCountryCode.toUpperCase() : null,
      visit.at,
      "place"
    );
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
            (a[1] ?? "9999-99-99").localeCompare(b[1] ?? "9999-99-99") || a[0].localeCompare(b[0])
        )
        .map(([iata]) => iata),
      isHome: acc.isHome,
      isNew: acc.firstYear === thisYear,
      evidence: acc.evidence,
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
        a.iata.localeCompare(b.iata)
    );

  const firstYears = countries.map((c) => c.firstYear).filter((y): y is number => y !== null);

  return {
    summary: {
      countries: countries.length,
      airports: firstSeen.size,
      entries: countries.reduce((sum, c) => sum + c.entries, 0),
      continentsVisited: visitedPerContinent.size,
      continentsTotal: Object.keys(totals).length,
      firstStampYear: firstYears.length > 0 ? Math.min(...firstYears) : null,
      newThisYear: countries.filter((c) => c.isNew).length,
      byEvidence: {
        flight: countries.filter((c) => c.evidence === "flight").length,
        port: countries.filter((c) => c.evidence === "port").length,
        place: countries.filter((c) => c.evidence === "place").length,
      },
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
