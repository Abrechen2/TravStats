import {
  airlineGroupKey,
  type AirlineIdentity,
  type AirlineResolvers,
} from "../../shared/airlineNormalize";
import type { SummaryFigure } from "../../components/table/ListSummaryStrip";

/**
 * The three numbers above the flight list, read straight off the rows on
 * screen — nothing estimated.
 *
 * Flight time and distance are both derived and are marked as estimates
 * wherever they appear, so they have no business being silently summed into a
 * headline. That is why this counts rows, airlines and airports and stops.
 *
 * The airline figure carries a note when it leaves rows out. The cell in the
 * table derives a carrier from the flight number so a logo can appear, while
 * the count counts the airlines a row actually RECORDS (`airlineGroupKey`,
 * forgejo#81 — the one rule every surface shares). Both are right, and side by
 * side without a word they read as a contradiction: measured on 2.7.0-beta.1,
 * two brands in the rows and "1 AIRLINES" in the header. `/stats` answers this
 * by reporting `withoutAirline` next to its ranking "so the ranking can say
 * what it is silent about"; this is the same sentence one surface further.
 *
 * Lives here rather than in the page because the page is on the file-size
 * ratchet's list, and because a pure function over rows is worth testing
 * without rendering a table.
 */

/**
 * The fields of a flight row this summary reads.
 *
 * `airline` is required-but-nullable rather than optional, because that is
 * what `AirlineIdentity` asks for: a row that has no airline says so with
 * `null`, and a row that forgot to mention the field is a different thing.
 */
export interface SummarisableFlight extends AirlineIdentity {
  depIata?: string | null;
  arrIata?: string | null;
}

export interface SummaryLabels {
  flights: string;
  airlines: string;
  airports: string;
  /** Takes the count, e.g. "+2 ohne Angabe". */
  withoutAirline: (count: number) => string;
}

export function flightSummaryFigures(
  flights: readonly SummarisableFlight[],
  resolvers: AirlineResolvers,
  labels: SummaryLabels
): SummaryFigure[] {
  const airlines = new Set<string>();
  const airports = new Set<string>();
  let withoutAirline = 0;

  for (const f of flights) {
    const key = airlineGroupKey(f, resolvers);
    if (key !== null) airlines.add(key);
    else withoutAirline += 1;
    if (f.depIata) airports.add(f.depIata);
    if (f.arrIata) airports.add(f.arrIata);
  }

  return [
    { key: "flights", value: String(flights.length), label: labels.flights },
    {
      key: "airlines",
      value: String(airlines.size),
      label: labels.airlines,
      note: withoutAirline > 0 ? labels.withoutAirline(withoutAirline) : undefined,
    },
    { key: "airports", value: String(airports.size), label: labels.airports },
  ];
}
