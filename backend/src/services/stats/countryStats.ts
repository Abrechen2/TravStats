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

export async function computeCountryStats(
  flights: ReadonlyArray<CountryRow>
): Promise<CountryStatsResponse> {
  const airportCodes = new Set<string>();
  for (const f of flights) {
    if (f.depIata) airportCodes.add(f.depIata);
    else if (f.depIcao) airportCodes.add(f.depIcao);
    if (f.arrIata) airportCodes.add(f.arrIata);
    else if (f.arrIcao) airportCodes.add(f.arrIcao);
  }

  const airportMap = await getCachedAirports([...airportCodes]);

  const countryCounts = new Map<string, number>();
  const countriesByYear = new Map<number, Set<string>>();
  for (const f of flights) {
    // BOTH ends count. This used to read the departure only, so a single
    // FRA -> LHR reported "Länder besucht: 1" and the United Kingdom
    // appeared nowhere — the KPI says VISITED, and landing somewhere is
    // the clearest way to visit it (#233).
    const depCode = f.depIata ?? f.depIcao;
    const arrCode = f.arrIata ?? f.arrIcao;
    const depAirport = depCode ? airportMap.get(depCode) : undefined;
    const arrAirport = arrCode ? airportMap.get(arrCode) : undefined;

    // A Set per flight, so a domestic leg is ONE visit to that country
    // rather than two. Across flights the counts still accumulate, which
    // keeps `countries` usable as a ranking.
    const touched = new Set<string>();
    touched.add(depAirport?.country ?? "Unknown");
    // Only when an arrival airport is actually on file — otherwise an
    // incomplete row would invent a second "Unknown" visit.
    if (arrCode) touched.add(arrAirport?.country ?? "Unknown");

    for (const country of touched) {
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    // An undated flight cannot be attributed to a year. It stays in the
    // lifetime tally rather than being guessed into the current one.
    if (!f.departureTime) continue;
    // The timezone lives on the airport, not the flight — same source the
    // flight list uses to derive depTimezone. Both endpoints land in the
    // DEPARTURE year: a red-eye that lands after midnight is still one
    // journey, and splitting its two ends across two years would count a
    // country as visited in a year the traveller never flew.
    const year = localWallClockOf(
      f.departureTime,
      depAirport?.timezone ?? null,
      f.depTimeSemantics as FlightTimeSemantics
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
