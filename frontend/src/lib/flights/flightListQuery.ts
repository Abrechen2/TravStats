import type { FlightFilters } from "../../types";
import type { SpecialTypeFilter } from "../../components/specialFlights/specialTypeMeta";
import type { FlightStatusFilter } from "../../components/flightsTable/flightColumns";

/**
 * The logbook's filter bar, as query parameters.
 *
 * One pure function, because this is the seam where the page stopped being
 * able to paginate. Every one of these decisions used to be made in the
 * browser over rows it had already fetched — which meant fetching all of
 * them, in a `limit=500` loop (measured 2026-09-20). Building the query
 * somewhere testable is what makes "the filter narrows the QUERY, not the
 * array" checkable without rendering a table.
 *
 * The bar says "all" where a filter is off; the API says "absent". That
 * translation is the only thing happening here, plus the two words the API
 * needs for the trip and special-type questions the bar asks in four values.
 */
export interface FlightListFilterState {
  /** Already debounced — see `useDebouncedValue`. */
  search: string;
  status: FlightStatusFilter;
  /** A year as a string, or "all". */
  year: string;
  /** A month 1-12 as a string, or "all". */
  month: string;
  /** A carrier name exactly as `/flights/facets` reports it, or "all". */
  airline: string;
  /** A trip id, "with", "without", or "all". */
  trip: string;
  special: SpecialTypeFilter;
}

export interface FlightListSortState {
  sortBy: "departureTime" | "airline" | "status" | "duration";
  sortOrder: "asc" | "desc";
}

/** Everything but the page: what the facet endpoint takes. */
export function buildFlightFilterQuery(state: FlightListFilterState): FlightFilters {
  const query: FlightFilters = {};
  const search = state.search.trim();
  if (search) query.q = search;
  if (state.status !== "all") query.status = state.status;
  if (state.year !== "all") query.year = Number(state.year);
  if (state.month !== "all") query.month = Number(state.month);
  // `airlineExact`, not `airline`: the latter is a substring match server-side,
  // so picking "LOT" would also return "LOT Polish Airlines" — two spellings
  // that both really occur (shared/airlineNormalize.ts).
  if (state.airline !== "all") query.airlineExact = state.airline;
  if (state.trip !== "all") query.tripId = state.trip;
  if (state.special !== "all") query.specialType = state.special;
  return query;
}

/** The filter query plus the sort and the page — what the list takes. */
export function buildFlightListQuery(
  state: FlightListFilterState,
  sort: FlightListSortState,
  page: { limit: number; offset: number }
): FlightFilters {
  return {
    ...buildFlightFilterQuery(state),
    sort: sort.sortBy,
    order: sort.sortOrder,
    limit: page.limit,
    offset: page.offset,
  };
}

/**
 * A stable string for "the filters are these".
 *
 * Used as an effect dependency and as the pager's reset key. Derived from the
 * built query rather than from the raw state so that two states the SERVER
 * cannot tell apart do not reload the list or bounce the reader to page 1.
 */
export function flightFilterSignature(state: FlightListFilterState): string {
  const query = buildFlightFilterQuery(state) as Record<string, unknown>;
  return Object.keys(query)
    .sort()
    .map((key) => `${key}=${String(query[key])}`)
    .join("&");
}
