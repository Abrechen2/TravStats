/**
 * Three folds over fields the logbook stores and no statistic read until now
 * (ledger stats-unused-data-opportunities, points 5–8): wheels-off→wheels-on
 * time, the countries on the flight path, and who really flew a codeshare.
 *
 * Every figure carries its COVERAGE — "n of m counted flights" — because only
 * flights the API enriched (or the user filled in) hold these fields. Nothing
 * is extrapolated to the flights without them, and a field no counted flight
 * carries yields `null`, never a zero. Population: `isCountedRow` (the flown
 * and historical rule of `shared/flightCounting.ts`), the same as every other
 * insight; the evidence resolvers walk the same predicates below.
 */

import type { RecordedFields } from "../../../schemas/statsFlightInsights";
import { type FlightInsightRow, isCountedRow } from "./rows";
import { resolveCountryCode } from "../../../shared/geo/countryCode";

/** How many operating carriers the codeshare block names. */
export const OPERATOR_LIST_LENGTH = 5;

const MS_PER_MINUTE = 60_000;

/**
 * Minutes between wheels-off and wheels-on, or null. Block time (the departure
 * and arrival columns) is NEVER substituted: a flight without both runway
 * times, or with them in the wrong order, is simply not measured.
 */
export function airborneMinutesOf(
  row: Pick<FlightInsightRow, "runwayDepartureTime" | "runwayArrivalTime">
): number | null {
  const off = row.runwayDepartureTime;
  const on = row.runwayArrivalTime;
  if (!off || !on) return null;
  const ms = on.getTime() - off.getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / MS_PER_MINUTE : null;
}

/**
 * Key of a recorded country: its ISO code where the text resolves ("DE",
 * "Germany", "Deutschland" are one), else the trimmed, case-folded text.
 */
export const countryKeyOf = (raw: string): string =>
  resolveCountryCode(raw) ?? raw.trim().toLowerCase();

/**
 * The distinct countries a row recorded: the ISO code where it resolves, so the
 * web can name it in the reader's language, else the text as first spelled.
 */
export function overflownOf(row: Pick<FlightInsightRow, "overflownCountries">): string[] {
  const seen = new Map<string, string>();
  for (const raw of row.overflownCountries) {
    const text = raw.trim();
    if (!text) continue;
    const key = countryKeyOf(text);
    if (!seen.has(key)) seen.set(key, resolveCountryCode(text) ?? text);
  }
  return [...seen.values()];
}

/** The carrier named on a codeshare flight, or null when it is not one / not named. */
export function operatorOf(
  row: Pick<FlightInsightRow, "isCodeshare" | "operatingAirline">
): string | null {
  if (row.isCodeshare !== true) return null;
  const name = row.operatingAirline?.trim();
  return name ? name : null;
}

export function foldRecordedFields(rows: readonly FlightInsightRow[]): RecordedFields {
  const counted = rows.filter(isCountedRow);
  const of = counted.length;

  const airborne = counted.flatMap((r) => airborneMinutesOf(r) ?? []);
  const airborneTotal = airborne.reduce((sum, m) => sum + m, 0);

  const countries = new Map<string, string>();
  let overflownFlights = 0;
  for (const row of counted) {
    const list = overflownOf(row);
    if (list.length === 0) continue;
    overflownFlights += 1;
    for (const name of list)
      if (!countries.has(countryKeyOf(name))) countries.set(countryKeyOf(name), name);
  }

  const known = counted.filter((r) => r.isCodeshare !== null);
  const codeshare = known.filter((r) => r.isCodeshare === true);
  const operators = new Map<string, { name: string; flights: number }>();
  for (const row of codeshare) {
    const name = operatorOf(row);
    if (name === null) continue;
    const key = name.toLowerCase();
    operators.set(key, {
      name: operators.get(key)?.name ?? name,
      flights: (operators.get(key)?.flights ?? 0) + 1,
    });
  }

  return {
    airborne:
      airborne.length === 0
        ? null
        : { minutes: Math.round(airborneTotal), flights: airborne.length, of },
    overflown:
      countries.size === 0
        ? null
        : {
            countries: [...countries.values()].sort((a, b) => a.localeCompare(b)),
            flights: overflownFlights,
            of,
          },
    codeshare:
      known.length === 0
        ? null
        : {
            codeshare: codeshare.length,
            known: known.length,
            of,
            operators: [...operators.values()]
              .sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name))
              .slice(0, OPERATOR_LIST_LENGTH),
          },
  };
}
