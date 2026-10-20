/**
 * The passport's figures, counted from its rows — and from nothing else.
 *
 * Split out of `buildPassport` for forgejo#308: a user's country override
 * changes rows AFTER the fold, and every total above the list must then be
 * counted again. Counting it twice by two pieces of code is how a headline
 * and the list beside it start to disagree, so both the automatic passport and
 * the overridden one call this one function.
 */

import type { Continent } from "../../utils/continents";
import { continentTotals } from "../../shared/passportContinents";
import type { Passport, PassportCountry } from "./passport";

/** The list order: most flights first, then by code — stable for equal rows. */
export const compareCountryRows = (a: PassportCountry, b: PassportCountry): number =>
  b.entries - a.entries || a.code.localeCompare(b.code);

/**
 * @param countries the final rows, overrides already applied
 * @param airports how many airports carry a stamp. Passed in because it is a
 *   fact about flights, not about country rows: a house proves a country and
 *   adds no airport.
 */
export function summarizePassport(
  countries: readonly PassportCountry[],
  airports: number
): Pick<Passport, "summary" | "continents"> {
  const totals = continentTotals();
  const visitedPerContinent = new Map<Continent, number>();
  for (const row of countries) {
    if (!row.continent || !row.counted) continue;
    visitedPerContinent.set(row.continent, (visitedPerContinent.get(row.continent) ?? 0) + 1);
  }
  const firstYears = countries.map((c) => c.firstYear).filter((y): y is number => y !== null);
  const counted = countries.filter((c) => c.counted).length;
  const withEvidence = (kind: PassportCountry["evidence"]): number =>
    countries.filter((c) => c.evidence === kind).length;
  const withTier = (tier: PassportCountry["tier"]): number =>
    countries.filter((c) => c.tier === tier).length;

  return {
    summary: {
      // Counted from the ROWS, not from the folded list beside them, so the
      // number and the list it belongs to can never answer differently.
      countries: counted,
      groundCountries: countries.length,
      visitedCountries: counted,
      unclearCountries: countries.filter((c) => c.visitUncertain).length,
      countriesTotal: countries.length,
      legacyCountries: countries.filter((c) => c.airports.length > 0).length,
      // The RESOLVED value, so a client never has to guess which rule produced
      // the number it is showing.
      countryThreshold: "visited",
      airports,
      entries: countries.reduce((sum, c) => sum + c.entries, 0),
      continentsVisited: visitedPerContinent.size,
      continentsTotal: Object.keys(totals).length,
      firstStampYear: firstYears.length > 0 ? Math.min(...firstYears) : null,
      newThisYear: countries.filter((c) => c.isNew).length,
      byEvidence: {
        flight: withEvidence("flight"),
        port: withEvidence("port"),
        place: withEvidence("place"),
        lodging: withEvidence("lodging"),
        rail: withEvidence("rail"),
        bus: withEvidence("bus"),
        ferry: withEvidence("ferry"),
        roadtrip: withEvidence("roadtrip"),
        track: withEvidence("track"),
        manual: withEvidence("manual"),
      },
      byTier: {
        slept: withTier("slept"),
        visited: withTier("visited"),
        transited: withTier("transited"),
        connection: withTier("connection"),
      },
    },
    continents: (Object.keys(totals) as Continent[])
      .map((continent) => ({
        continent,
        visited: visitedPerContinent.get(continent) ?? 0,
        total: totals[continent],
      }))
      .sort((a, b) => b.visited - a.visited || a.continent.localeCompare(b.continent)),
  };
}
