/**
 * Countries reached, and the ISO sets the cross-domain figures union.
 *
 * Lifted out of `routes/stats.ts` for forgejo#49 — unchanged. `GET
 * /stats/countries` and the composed `GET /stats/page` both answer with this,
 * from the same rows: two copies of "does landing somewhere count as visiting
 * it" is how #233 happened the first time.
 *
 * The airport lookup is the CACHED catalogue (`getCachedAirports`), not a
 * second query against the flight table, so composing this costs no scan.
 */

import { getCachedAirports } from "../airportCache";
import { flightEndZone, tzMapFromAirports } from "./departureClock";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { normalizeCountrySet } from "../../shared/countryEvidence";
import type { CountryStat, CountryStatsResponse } from "../../schemas/statsFlights";

/** Everything a country figure is derived from. */
export interface CountryRow {
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  departureTime: Date | null;
  depTimeSemantics: string;
  /** The zone the departure was written with; absent → today's catalogue zone. */
  depTimezone?: string | null;
  /** `year`/`month` for a placeholder date (forgejo#256). */
  depPrecision?: string | null;
}

/**
 * Fold a set of country names/codes into sorted, deduplicated ISO alpha-2.
 * Unresolvable entries are dropped: they cannot be deduplicated against the
 * other catalogue, so keeping them would reintroduce the double count this
 * exists to remove.
 *
 * The join is `shared/countryEvidence.ts`'s, not a local one. This used to call
 * the English-only `isoCountryCode` alone, which is the same half-resolution
 * that gave `countryDetail.ts` a country row whose drill-down could not name
 * the record behind it. Reading BOTH resolvers is strictly more generous —
 * measured over the whole airport and port catalogue no code changed and none
 * was lost — and it stops a two-character non-Latin string ("日本") being
 * published as if it were a country code.
 *
 * These are LISTS, and they stay lists: the counting threshold of design §3.2
 * moves the passport headline and nothing here.
 */
export function isoCodes(values: Iterable<string>): string[] {
  return [...normalizeCountrySet(values)].sort();
}

/** The code an end is looked up by: IATA, else ICAO — `||`, so an empty IATA falls through. */
const endCode = (iata: string | null, icao: string | null): string | null => iata || icao || null;

/** The bucket of an end whose country nobody can name — said, never dropped. */
export const UNKNOWN_COUNTRY = "Unknown";

/**
 * The countries ONE flight touches, as the distribution counts them — the one
 * home of that rule, read by `computeCountryStats` and by the country
 * ranking's evidence (forgejo#256).
 *
 * BOTH ends count, and both the same way: the catalogue's country of the
 * end's airport, else `Unknown` — whether the end names no code or a code the
 * catalogue cannot place. It used to differ by end: a departure without a code
 * counted as Unknown while an arrival without one was dropped. A Set, so a
 * domestic leg (or a leg with two unknown ends) is ONE visit.
 */
export function countriesTouchedBy(
  f: Pick<CountryRow, "depIata" | "depIcao" | "arrIata" | "arrIcao">,
  airportMap: ReadonlyMap<string, { country?: string | null } | null | undefined>
): Set<string> {
  const countryOf = (code: string | null): string =>
    (code ? airportMap.get(code)?.country : null) || UNKNOWN_COUNTRY;
  return new Set([
    countryOf(endCode(f.depIata, f.depIcao)),
    countryOf(endCode(f.arrIata, f.arrIcao)),
  ]);
}

export async function computeCountryStats(
  flights: ReadonlyArray<CountryRow>
): Promise<CountryStatsResponse> {
  const airportCodes = new Set<string>();
  for (const f of flights) {
    for (const code of [endCode(f.depIata, f.depIcao), endCode(f.arrIata, f.arrIcao)]) {
      if (code) airportCodes.add(code);
    }
  }

  const airportMap = await getCachedAirports([...airportCodes]);
  const tzMap = tzMapFromAirports(airportMap);

  const countryCounts = new Map<string, number>();
  const countriesByYear = new Map<number, Set<string>>();
  for (const f of flights) {
    // BOTH ends count. This used to read the departure only, so a single
    // FRA -> LHR reported "Länder besucht: 1" and the United Kingdom
    // appeared nowhere — the KPI says VISITED, and landing somewhere is
    // the clearest way to visit it (#233).
    const touched = countriesTouchedBy(f, airportMap);

    for (const country of touched) {
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    // An undated flight cannot be attributed to a year. It stays in the
    // lifetime tally rather than being guessed into the current one.
    if (!f.departureTime) continue;
    // The zone the flight was written with, else today's catalogue zone
    // (`flightEndZone`, the chain every other flight figure reads) — so a
    // catalogue correction cannot move a past flight's year here alone
    // (forgejo#273). Both endpoints land in the DEPARTURE year: a red-eye
    // that lands after midnight is still one journey, and splitting its two
    // ends across two years would count a country as visited in a year the
    // traveller never flew.
    const year = localWallClockOf(
      f.departureTime,
      flightEndZone(f.depTimezone, tzMap, f.depIata, f.depIcao),
      f.depTimeSemantics as FlightTimeSemantics,
      f.depPrecision
    ).year;
    if (!Number.isFinite(year)) continue;
    const bucket = countriesByYear.get(year) ?? new Set<string>();
    for (const country of touched) bucket.add(country);
    countriesByYear.set(year, bucket);
  }

  const countries: CountryStat[] = [...countryCounts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  const byYear: Record<string, string[]> = {};
  for (const [year, set] of countriesByYear) {
    byYear[String(year)] = isoCodes(set);
  }

  return {
    countries,
    total: flights.length,
    countriesIso: isoCodes(countryCounts.keys()),
    byYear,
  };
}
