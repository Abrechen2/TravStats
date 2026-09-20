import { describe, expect, it } from "vitest";
import {
  buildFlightFilterQuery,
  buildFlightListQuery,
  flightFilterSignature,
  type FlightListFilterState,
} from "../flightListQuery";

/**
 * The filter bar, as query parameters.
 *
 * This is the seam the logbook's pagination hangs from: until 2026-09-20 each
 * of these decisions was made in the browser over rows it had already
 * fetched, which is why it fetched all of them. A filter that does not reach
 * the query cannot page.
 */
const none: FlightListFilterState = {
  search: "",
  status: "all",
  year: "all",
  month: "all",
  airline: "all",
  trip: "all",
  special: "all",
};

describe("buildFlightFilterQuery", () => {
  it("sends nothing when nothing is filtered", () => {
    expect(buildFlightFilterQuery(none)).toEqual({});
  });

  it("sends every filter the bar can set", () => {
    expect(
      buildFlightFilterQuery({
        search: "  kastrup ",
        status: "flown",
        year: "2024",
        month: "3",
        airline: "Lufthansa",
        trip: "with",
        special: "aurora",
      })
    ).toEqual({
      q: "kastrup",
      status: "flown",
      year: 2024,
      month: 3,
      airlineExact: "Lufthansa",
      tripId: "with",
      specialType: "aurora",
    });
  });

  it("sends the carrier as an EXACT match", () => {
    // `airline` is a substring match server-side, so "LOT" would also return
    // the rows spelled "LOT Polish Airlines" — two spellings that both really
    // occur (shared/airlineNormalize.ts).
    const query = buildFlightFilterQuery({ ...none, airline: "LOT" });
    expect(query.airlineExact).toBe("LOT");
    expect(query.airline).toBeUndefined();
  });

  it("sends year and month as numbers, because the bar holds strings", () => {
    const query = buildFlightFilterQuery({ ...none, year: "2024", month: "11" });
    expect(query.year).toBe(2024);
    expect(query.month).toBe(11);
  });

  it("treats a whitespace-only search as no search", () => {
    expect(buildFlightFilterQuery({ ...none, search: "   " })).toEqual({});
  });

  /**
   * The server caps `q` at 100 characters and answers a longer one with a
   * 400 — which the list page can only draw as "the flights could not be
   * loaded". A pasted paragraph would turn a working table red and blank the
   * facets beside it. Truncating finds fewer things; erroring finds nothing
   * and blames the wrong thing.
   */
  it("truncates a search past what the server accepts, instead of sending a 400", () => {
    const query = buildFlightFilterQuery({ ...none, search: "x".repeat(150) });
    expect(query.q).toHaveLength(100);
  });

  it("truncates after trimming, so padding does not eat the search", () => {
    const query = buildFlightFilterQuery({ ...none, search: `   ${"y".repeat(100)}   ` });
    expect(query.q).toBe("y".repeat(100));
  });
});

describe("buildFlightListQuery", () => {
  it("carries the sort and the page", () => {
    expect(
      buildFlightListQuery(none, { sortBy: "airline", sortOrder: "asc" }, { limit: 25, offset: 50 })
    ).toEqual({ sort: "airline", order: "asc", limit: 25, offset: 50 });
  });

  it("page 2 at 25 rows asks for limit 25 and offset 25", () => {
    const query = buildFlightListQuery(
      none,
      { sortBy: "departureTime", sortOrder: "desc" },
      { limit: 25, offset: 25 }
    );
    expect(query.limit).toBe(25);
    expect(query.offset).toBe(25);
  });
});

describe("flightFilterSignature", () => {
  it("is stable under the order the filters happen to be set in", () => {
    const a = flightFilterSignature({ ...none, airline: "Lufthansa", year: "2024" });
    const b = flightFilterSignature({ ...none, year: "2024", airline: "Lufthansa" });
    expect(a).toBe(b);
  });

  it("changes when a filter does", () => {
    expect(flightFilterSignature({ ...none, airline: "Lufthansa" })).not.toBe(
      flightFilterSignature(none)
    );
  });

  // Derived from the QUERY, not the state: two states the server cannot tell
  // apart must not reload the list or bounce the reader back to page 1.
  it("does not change when a search gains only whitespace", () => {
    expect(flightFilterSignature({ ...none, search: "muc" })).toBe(
      flightFilterSignature({ ...none, search: " muc " })
    );
  });
});
