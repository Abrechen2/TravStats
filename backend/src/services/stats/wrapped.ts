/**
 * The year in review — Forgejo #42, the last of the four pieces.
 *
 * The Companion builds this story (04b) client-side in `wrappedFromServer`,
 * from `/stats/timeseries` plus the raw flight and cruise lists. That is a
 * third set of counting rules living in a client, and the two below would have
 * disagreed with this server the moment they were copied into the web app —
 * which is what #42 is about. Ported, not reinvented.
 *
 * ## The three rules the Companion baked in, kept verbatim
 *
 * 1. THE YEAR COMES FROM THE DATA, never the wall clock. Without `?year=` the
 *    story is about the latest year that has anything in it, so the same
 *    account tells the same story on New Year's Eve and the morning after.
 * 2. `rank` IS EXACT. 'second' only when exactly one year had more flights —
 *    because the intro names that year — and 'top' only when none did.
 *    Everything else is 'other' and the copy stays vague on purpose.
 * 3. A FAVOURITE THE YEAR CANNOT SUPPORT IS OMITTED, never zeroed. The story
 *    then skips that page instead of inventing content, the same abstention
 *    `records.ts` makes.
 *
 * ## The two places this deliberately departs from the Companion
 *
 * **The top route is the PAIR, not the direction.** The Companion keys
 * `dep→arr`; `/stats/routes` on this branch groups both directions under one
 * sorted key, because a person who says "I flew Munich–Dubai eleven times"
 * means both ways. A wrapped story that ranked directions would contradict the
 * top-routes list on the same account — one endpoint, two answers, which is the
 * exact fault being fixed.
 *
 * **`newCountries` counts EVIDENCE.** The Companion counts countries first
 * FLOWN to in the year; the passport on this branch counts a port call and a
 * recorded place as proof too. Taking the number from the passport's own
 * per-country first year means "new countries" means one thing on this server.
 *
 * ## What is not here
 *
 * No `moment` (there is no server source for a photo of the year), and no
 * percentage of the world's countries — 197 or 193 is a choice nobody has made
 * here, and the continent totals are the mockup's, not a standard.
 */

const FLOWN = new Set(["flown", "historical"]);

/** Mean circumference. Only ever used for the "times around the Earth" figure. */
const EARTH_CIRCUMFERENCE_KM = 40075;

/** The columns the derivation reads. Any flight row is a superset. */
export interface WrappedFlight {
  depIata: string | null;
  arrIata: string | null;
  departureTime: Date | null;
  airline: string | null;
  flightNumber: string | null;
  status: string;
  /**
   * Great-circle kilometres, computed by the caller with the same helper
   * `/stats/timeseries` uses — so the year's distance here and the year's
   * bucket there are the same number.
   */
  distanceKm: number;
}

export interface WrappedCruise {
  startDate: Date | null;
  status: string;
}

/** What the passport already knows about a country, and all this needs of it. */
export interface WrappedCountry {
  firstYear: number | null;
}

export type WrappedRank = "top" | "second" | "other";

export interface Wrapped {
  year: number;
  /**
   * Every year with countable activity, ascending. Here so a client can offer
   * a year picker without a second round trip — and so it never offers a year
   * the story would be empty for.
   */
  availableYears: number[];
  rank: WrappedRank;
  /** The one year that beat this one, when exactly one did. See rule 2. */
  comparisonYear: number | null;
  flights: number;
  distanceKm: number;
  /** `distanceKm` in trips around the Earth, one decimal. */
  earthFactor: number;
  /** Countries first evidenced in this year. See the header. */
  newCountries: number;
  cruises: number;
  /** The year's most-flown carrier. Null when no flight named one. */
  topAirline: { name: string; code: string | null; flights: number } | null;
  /** The year's most-flown pair, codes sorted. Null when none is derivable. */
  topRoute: { from: string; to: string; flights: number } | null;
}

const yearOf = (at: Date | null): number | null => (at ? at.getUTCFullYear() : null);

/**
 * The two-letter prefix of a flight number, which is the airline's IATA code
 * when the number is written the usual way. Null rather than a guess otherwise
 * — the name is the identity here, the code only decorates a tile.
 */
const airlineCodeOf = (flightNumber: string | null): string | null => {
  const match = (flightNumber ?? "").match(/^([A-Z]{2})\s?\d/i);
  return match ? match[1].toUpperCase() : null;
};

/**
 * @param requestedYear null asks for the latest year that has anything in it
 * @returns null when the account has no countable activity in any year at all —
 *          there is no story to tell, and a grid of zeros would pretend there is
 */
export function buildWrapped(
  flights: readonly WrappedFlight[],
  cruises: readonly WrappedCruise[],
  countries: readonly WrappedCountry[],
  requestedYear: number | null = null
): Wrapped | null {
  const flown = flights.filter((f) => FLOWN.has(f.status) && f.departureTime !== null);
  const sailed = cruises.filter((c) => FLOWN.has(c.status) && c.startDate !== null);

  const flightsPerYear = new Map<number, number>();
  for (const flight of flown) {
    const year = yearOf(flight.departureTime);
    if (year === null) continue;
    flightsPerYear.set(year, (flightsPerYear.get(year) ?? 0) + 1);
  }
  const cruisesPerYear = new Map<number, number>();
  for (const cruise of sailed) {
    const year = yearOf(cruise.startDate);
    if (year === null) continue;
    cruisesPerYear.set(year, (cruisesPerYear.get(year) ?? 0) + 1);
  }

  const availableYears = [...new Set([...flightsPerYear.keys(), ...cruisesPerYear.keys()])].sort(
    (a, b) => a - b
  );
  if (availableYears.length === 0) return null;

  // Rule 1: read off the data. An explicitly requested year is honoured even
  // when it is empty — "you flew nothing in 2019" is a true answer to a
  // question that was asked; picking a different year would not be.
  const year = requestedYear ?? availableYears[availableYears.length - 1];

  const inYear = flown.filter((f) => yearOf(f.departureTime) === year);
  const distanceKm = Math.round(
    inYear.reduce((sum, f) => sum + (Number.isFinite(f.distanceKm) ? f.distanceKm : 0), 0)
  );

  // Rule 2: exact. Counted over every year, including ones this account has
  // only cruises in — those simply contribute zero flights.
  const bigger = [...flightsPerYear.entries()].filter(
    ([other, count]) => other !== year && count > (flightsPerYear.get(year) ?? 0)
  );

  const byAirline = new Map<string, { flights: number; code: string | null }>();
  for (const flight of inYear) {
    const name = flight.airline?.trim();
    if (!name) continue;
    const acc = byAirline.get(name) ?? { flights: 0, code: null };
    acc.flights += 1;
    acc.code ??= airlineCodeOf(flight.flightNumber);
    byAirline.set(name, acc);
  }
  const topAirline = [...byAirline.entries()].sort(
    (a, b) => b[1].flights - a[1].flights || a[0].localeCompare(b[0])
  )[0];

  const byRoute = new Map<string, { from: string; to: string; flights: number }>();
  for (const flight of inYear) {
    if (!flight.depIata || !flight.arrIata) continue;
    // Sorted, so both directions land on one entry — the rule /stats/routes
    // follows since Forgejo #42.
    const [from, to] = [flight.depIata.toUpperCase(), flight.arrIata.toUpperCase()].sort();
    const key = `${from}-${to}`;
    const acc = byRoute.get(key) ?? { from, to, flights: 0 };
    acc.flights += 1;
    byRoute.set(key, acc);
  }
  const topRoute = [...byRoute.entries()].sort(
    (a, b) => b[1].flights - a[1].flights || a[0].localeCompare(b[0])
  )[0];

  // A year with no flights has no flying rank to hold. Calling it 'top'
  // because nothing beat it would let a cruise-only year headline as the
  // biggest flying year of somebody's life.
  const ranked = inYear.length > 0;

  return {
    year,
    availableYears,
    rank: !ranked
      ? "other"
      : bigger.length === 0
        ? "top"
        : bigger.length === 1
          ? "second"
          : "other",
    comparisonYear: ranked && bigger.length === 1 ? bigger[0][0] : null,
    flights: inYear.length,
    distanceKm,
    earthFactor: Math.round((distanceKm / EARTH_CIRCUMFERENCE_KM) * 10) / 10,
    newCountries: countries.filter((c) => c.firstYear === year).length,
    cruises: cruisesPerYear.get(year) ?? 0,
    topAirline:
      topAirline === undefined
        ? null
        : { name: topAirline[0], code: topAirline[1].code, flights: topAirline[1].flights },
    topRoute: topRoute === undefined ? null : topRoute[1],
  };
}
