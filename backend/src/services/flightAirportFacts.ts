/**
 * The airport-derived fields every flight read path owes its callers.
 *
 * A flight row stores UTC plus time semantics and carries no zone of its own,
 * so rendering a departure in ITS airport's clock needs the catalogue. The
 * same lookup answers two more questions for free: which countries the flight
 * touched, and how long it actually took once both zones are accounted for.
 *
 * THIS LIVES IN ONE PLACE BECAUSE IT ALREADY DRIFTED. The list endpoint
 * enriched, the single-flight endpoint did not, and the flight detail page —
 * which shares its time component with the list — silently fell back to UTC:
 * a Munich departure of 12:16 read "10:16 UTC" on its own page while the list
 * and the trip timeline both said 12:16. A read path that returns flights to a
 * client calls this; adding one that does not brings the bug back.
 */

import { getCachedAirports } from "./airportCache";
import { tzAwareDurationMinutes, type FlightTimeSemantics } from "../utils/timezone";

/** The columns the enrichment reads. Deliberately narrow: any flight row fits. */
export interface EnrichableFlight {
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
}

export interface AirportFacts {
  depTimezone: string | null;
  arrTimezone: string | null;
  depCountry: string | null;
  arrCountry: string | null;
  /** null when the times are DATE_ONLY — the display layer draws a great-circle estimate instead. */
  durationMinutes: number | null;
}

/**
 * Enrich a batch of flights in ONE catalogue lookup.
 *
 * A failed lookup is not an error: every field comes back null and the caller
 * still answers. Losing the timezone costs a correctly-labelled clock; losing
 * the whole response costs the page.
 */
export async function enrichFlightsWithAirportFacts<T extends EnrichableFlight>(
  flights: T[],
): Promise<Array<T & AirportFacts>> {
  const codes = new Set<string>();
  for (const f of flights) {
    for (const code of [f.depIata, f.depIcao, f.arrIata, f.arrIcao]) {
      if (code) codes.add(code);
    }
  }

  const tzMap = new Map<string, string>();
  const countryMap = new Map<string, string>();
  if (codes.size > 0) {
    try {
      const airports = await getCachedAirports(Array.from(codes));
      for (const [code, data] of airports.entries()) {
        if (data?.timezone) tzMap.set(code, data.timezone);
        if (data?.country) countryMap.set(code, data.country);
      }
    } catch {
      /* catalogue unreachable — every field stays null, durations use a naive diff */
    }
  }

  const lookup = (
    map: Map<string, string>,
    iata: string | null,
    icao: string | null,
  ): string | null => (iata && map.get(iata)) || (icao && map.get(icao)) || null;

  return flights.map((f) => {
    const depTimezone = lookup(tzMap, f.depIata, f.depIcao);
    const arrTimezone = lookup(tzMap, f.arrIata, f.arrIcao);
    const rawDuration =
      f.departureTime && f.arrivalTime
        ? tzAwareDurationMinutes(
            f.departureTime,
            f.arrivalTime,
            depTimezone,
            arrTimezone,
            f.depTimeSemantics as FlightTimeSemantics,
            f.arrTimeSemantics as FlightTimeSemantics,
          )
        : null;
    return {
      ...f,
      depTimezone,
      arrTimezone,
      depCountry: lookup(countryMap, f.depIata, f.depIcao),
      arrCountry: lookup(countryMap, f.arrIata, f.arrIcao),
      durationMinutes: rawDuration === null ? null : Math.round(rawDuration),
    };
  });
}
