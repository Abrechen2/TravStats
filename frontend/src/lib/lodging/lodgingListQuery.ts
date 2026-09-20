import type {
  LodgingListQuery,
  LodgingSortKey,
  LodgingType,
  StayStatus,
} from "../../types/lodging";

/**
 * The lodging list's filter bar, as query parameters.
 *
 * The same seam `lib/flights/flightListQuery.ts` names, for the same reason
 * and one week later: every one of these decisions used to be made in the
 * browser over rows it had already fetched, which meant fetching all of them —
 * here through a `limit=500` loop that ran until the account was exhausted,
 * and then a SECOND time unfiltered just to fill two dropdowns (measured by
 * the audit of 2026-09-19).
 *
 * A pure function, so "the filter narrows the QUERY, not the array" is
 * checkable without rendering a table.
 *
 * The bar says "all" where a filter is off; the API says absent. That
 * translation is the only thing happening here.
 */
export interface LodgingListFilterState {
  /** Already debounced — see `useDebouncedValue`. */
  search: string;
  /** A stay status, or "all". */
  status: StayStatus | "all";
  /** A year, or "all". */
  year: number | "all";
  /** An ISO code, a raw country text, or "all" — whatever `/lodging/facets` reported. */
  country: string | "all";
  type: LodgingType | "all";
}

/** Columns that read naturally ascending on first click; the rest start descending. */
export const LODGING_SORT_DEFAULT_ASC: readonly LodgingSortKey[] = [
  "name",
  "chain",
  "location",
  "status",
];

export interface LodgingListSortState {
  sortBy: LodgingSortKey;
  sortOrder: "asc" | "desc";
}

/** Everything but the page: what the facet endpoint takes. */
export function buildLodgingFilterQuery(state: LodgingListFilterState): LodgingListQuery {
  const query: LodgingListQuery = {};
  const search = state.search.trim();
  // The server caps `search` at 200 characters and answers a longer one with a
  // 400, which this page can only draw as "the lodgings could not be loaded" —
  // a broken-looking table under a search box somebody was simply typing into.
  if (search) query.search = search.slice(0, 200);
  if (state.status !== "all") query.status = state.status;
  if (state.year !== "all") query.year = state.year;
  if (state.country !== "all") query.country = state.country;
  if (state.type !== "all") query.type = state.type;
  return query;
}

/** The filter query plus the sort and the page — what the list takes. */
export function buildLodgingListQuery(
  state: LodgingListFilterState,
  sort: LodgingListSortState,
  page: { limit: number; offset: number }
): LodgingListQuery {
  return {
    ...buildLodgingFilterQuery(state),
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
 * BUILT query rather than from the raw state, so two states the server cannot
 * tell apart do not reload the list or bounce the reader back to page 1.
 */
export function lodgingFilterSignature(state: LodgingListFilterState): string {
  const query = buildLodgingFilterQuery(state) as Record<string, unknown>;
  return Object.keys(query)
    .sort()
    .map((key) => `${key}=${String(query[key])}`)
    .join("&");
}
