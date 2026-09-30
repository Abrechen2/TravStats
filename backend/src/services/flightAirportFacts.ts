/**
 * The airport-derived fields every flight read path owes its callers.
 *
 * A flight row stores UTC plus time semantics; since ADR 0002 phase 2 it also
 * stores the zone each end was written with, which wins. Rows written before
 * that carry none, and rendering them in their airport's clock needs the
 * catalogue. The
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
import logger from "../utils/logger";
import { tzAwareDurationMinutes, type FlightTimeSemantics } from "../utils/timezone";
import { flightTimes, type FlightTimeColumns } from "./flights/timesDto";
import type { FlightTimes } from "../schemas/times";

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
  /** The zone the end was WRITTEN with (ADR 0002 phase 2); absent on narrow selects. */
  depTimezone?: string | null;
  arrTimezone?: string | null;
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
  flights: T[]
): Promise<Array<T & AirportFacts>> {
  return (await withCatalogue(flights)).map(({ enriched }) => enriched);
}

/**
 * The enrichment plus the flight's `times` (ADR 0002 phase 4) — for every
 * path that hands a flight to a client. It takes the full row: `times` needs
 * the zone and precision the flight was STORED with, which a narrow select
 * (the statistics) would leave out and so misreport as catalogue-sourced.
 */
export type ClientFlight = EnrichableFlight & FlightTimeColumns;

export async function enrichFlightsForClients<T extends ClientFlight>(
  flights: T[]
): Promise<Array<T & AirportFacts & { times: FlightTimes }>> {
  return (await withCatalogue(flights)).map(({ enriched, catalogue }) => ({
    ...enriched,
    times: flightTimes(flights[catalogue.index], catalogue),
  }));
}

async function withCatalogue<T extends EnrichableFlight>(
  flights: T[]
): Promise<
  Array<{
    enriched: T & AirportFacts;
    catalogue: { index: number; dep: string | null; arr: string | null };
  }>
> {
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
    } catch (error) {
      // Every catalogue field stays null and durations use a naive diff; a
      // stored zone is unaffected. Logged, because a silent miss here would
      // label every legacy flight's clock as UTC with nobody knowing why.
      logger.warn({ operation: "flight_airport_facts_catalogue_failed", error });
    }
  }

  const lookup = (
    map: Map<string, string>,
    iata: string | null,
    icao: string | null
  ): string | null => (iata && map.get(iata)) || (icao && map.get(icao)) || null;

  return flights.map((f, index) => {
    const depCatalogue = lookup(tzMap, f.depIata, f.depIcao);
    const arrCatalogue = lookup(tzMap, f.arrIata, f.arrIcao);
    // The stored zone first (ADR 0002 D2): it is what the times were written
    // in, and an edit form resends the zone a read hands it — answering with
    // today's catalogue instead let a seat edit overwrite the stored zone.
    // The catalogue only answers for a row written before zones were stored.
    const depTimezone = f.depTimezone || depCatalogue;
    const arrTimezone = f.arrTimezone || arrCatalogue;
    const rawDuration =
      f.departureTime && f.arrivalTime
        ? tzAwareDurationMinutes(
            f.departureTime,
            f.arrivalTime,
            depTimezone,
            arrTimezone,
            f.depTimeSemantics as FlightTimeSemantics,
            f.arrTimeSemantics as FlightTimeSemantics
          )
        : null;
    const enriched = {
      ...f,
      depTimezone,
      arrTimezone,
      depCountry: lookup(countryMap, f.depIata, f.depIcao),
      arrCountry: lookup(countryMap, f.arrIata, f.arrIcao),
      durationMinutes: rawDuration === null ? null : Math.round(rawDuration),
    };
    return { enriched, catalogue: { index, dep: depCatalogue, arr: arrCatalogue } };
  });
}
