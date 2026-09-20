/**
 * `GET /flights/facets` — the option lists and figures drawn AROUND the
 * flight table, as opposed to the rows in it.
 *
 * Its own file rather than another entry in `types/index.ts`, which sits four
 * lines under the 800-line limit. The endpoint is what lets the logbook page
 * on the server: the year and airline dropdowns and the summary strip used to
 * be derived from the complete row set in the browser, which is why the page
 * fetched every flight the account owns before it could draw one page
 * (measured 2026-09-20).
 */

/** One option in a filter dropdown, with how many rows carry it. */
export interface FlightFacetOption<T extends string | number> {
  value: T;
  count: number;
}

export interface FlightFacets {
  /** Departure years present under the current filters, newest first. */
  years: FlightFacetOption<number>[];
  /** Carrier names as stored, most flights first, then alphabetically. */
  airlines: FlightFacetOption<string>[];
  summary: {
    flights: number;
    /** Distinct carriers by IATA identity — see `shared/airlineNormalize`. */
    airlines: number;
    /** Distinct IATA codes across both ends of the filtered flights. */
    airports: number;
    /** Flights naming no carrier, so the count can say what it omits. */
    withoutAirline: number;
  };
}
