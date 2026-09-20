import { describe, expect, it } from "vitest";
import {
  buildLodgingFilterQuery,
  buildLodgingListQuery,
  lodgingFilterSignature,
  type LodgingListFilterState,
} from "../lodgingListQuery";

/**
 * The filter bar, as query parameters.
 *
 * The seam the lodging list's pagination hangs from — the same one
 * `flightListQuery.test.ts` describes for the logbook. Until 2026-09-20 every
 * decision below was made in the browser over rows it had already fetched,
 * which is why it fetched all of them, twice: once through a `limit=500` loop
 * for the table, and once unfiltered to fill the year and country dropdowns.
 * A filter that does not reach the query cannot page.
 */
const none: LodgingListFilterState = {
  search: "",
  status: "all",
  year: "all",
  country: "all",
  type: "all",
};

describe("buildLodgingFilterQuery", () => {
  it("sends nothing when nothing is filtered", () => {
    expect(buildLodgingFilterQuery(none)).toEqual({});
  });

  it("translates the bar's 'all' into the API's absent, one key at a time", () => {
    expect(buildLodgingFilterQuery({ ...none, type: "campsite" })).toEqual({ type: "campsite" });
    expect(buildLodgingFilterQuery({ ...none, year: 2023 })).toEqual({ year: 2023 });
    expect(buildLodgingFilterQuery({ ...none, country: "DE" })).toEqual({ country: "DE" });
    expect(buildLodgingFilterQuery({ ...none, status: "scheduled" })).toEqual({
      status: "scheduled",
    });
  });

  it("sends a country the server could not resolve as the text it stored", () => {
    // "Dubai" is a city in the country field. The facet reports it under its
    // own text and the filter accepts it back verbatim — dropping it would
    // take those houses out of the filter entirely.
    expect(buildLodgingFilterQuery({ ...none, country: "Dubai" })).toEqual({ country: "Dubai" });
  });

  it("trims the search, and omits it when only whitespace was typed", () => {
    expect(buildLodgingFilterQuery({ ...none, search: "  adlon  " })).toEqual({ search: "adlon" });
    expect(buildLodgingFilterQuery({ ...none, search: "   " })).toEqual({});
  });

  it("truncates an over-long search instead of letting the server reject it", () => {
    // The server caps `search` at 200 characters and answers a longer one with
    // a 400, which this page can only draw as "the lodgings could not be
    // loaded" — a broken table under a box somebody was simply typing into.
    const query = buildLodgingFilterQuery({ ...none, search: "x".repeat(250) });
    expect(query.search).toHaveLength(200);
  });
});

describe("buildLodgingListQuery", () => {
  it("adds the sort and the page window to the same filters", () => {
    expect(
      buildLodgingListQuery(
        { ...none, type: "hotel" },
        { sortBy: "nights", sortOrder: "asc" },
        { limit: 25, offset: 50 }
      )
    ).toEqual({ type: "hotel", sort: "nights", order: "asc", limit: 25, offset: 50 });
  });
});

describe("lodgingFilterSignature", () => {
  it("is the same string for two states the SERVER cannot tell apart", () => {
    // Otherwise a keystroke that trims away to the same query would reload the
    // list and bounce the reader back to page 1.
    expect(lodgingFilterSignature({ ...none, search: "adlon" })).toBe(
      lodgingFilterSignature({ ...none, search: "  adlon " })
    );
  });

  it("changes when a filter does, whatever order the state was built in", () => {
    const a = lodgingFilterSignature({ ...none, type: "hotel", year: 2024 });
    const b = lodgingFilterSignature({ ...none, year: 2024, type: "hotel" });
    expect(a).toBe(b);
    expect(a).not.toBe(lodgingFilterSignature({ ...none, type: "hotel" }));
  });
});
