/**
 * `walkNights` steps a stay's span one day at a time to bucket nights by
 * year/month. The schema now caps a new stay's checkIn/checkOut span at 3650
 * nights (schemas/lodging.ts), but a row already in the database can predate
 * that validation — so `walkNights` itself must not loop unboundedly on a
 * wide span. Found by an independent Codex review (2026-09-17): a stay saved
 * with checkIn="0001-01-01" / checkOut="9999-12-31" made every later
 * lodging-statistics request loop ~3.6 million times and build ~3.6M-entry
 * `nightsByYear`/`nightsByMonth` maps, which were then serialised into the
 * response.
 */
import { walkNights } from "../nights";

describe("walkNights", () => {
  it("counts every night of an ordinary short stay", () => {
    const nightsByYear: Record<string, number> = {};
    const nightsByMonth: Record<string, number> = {};
    const n = walkNights(
      new Date("2024-05-01T00:00:00.000Z"),
      new Date("2024-05-04T00:00:00.000Z"),
      nightsByYear,
      nightsByMonth
    );
    expect(n).toBe(3);
    expect(nightsByYear).toEqual({ "2024": 3 });
    expect(Object.keys(nightsByMonth)).toEqual(["2024-05"]);
  });

  // A 100-year span (36,525 days) is far past the 3650-night cap the schema
  // now enforces on new writes. A pre-existing row this wide must still be
  // walked in bounded time and bounded memory, not looped day-by-day to the
  // end of its span.
  it("stops at the 3650-night cap for a 100-year span, instead of walking all ~36,525 days", () => {
    const nightsByYear: Record<string, number> = {};
    const nightsByMonth: Record<string, number> = {};
    const n = walkNights(
      new Date("1900-01-01T00:00:00.000Z"),
      new Date("2000-01-01T00:00:00.000Z"),
      nightsByYear,
      nightsByMonth
    );
    expect(n).toBe(3650);
    expect(Object.keys(nightsByMonth).length).toBeLessThanOrEqual(3650 / 28 + 1);
    expect(Object.keys(nightsByYear).length).toBeLessThanOrEqual(11);
  });

  it("still counts a span at exactly the cap in full", () => {
    const nightsByYear: Record<string, number> = {};
    const nightsByMonth: Record<string, number> = {};
    const checkIn = new Date("2020-01-01T00:00:00.000Z");
    const checkOut = new Date(checkIn.getTime() + 3650 * 24 * 60 * 60 * 1000);
    const n = walkNights(checkIn, checkOut, nightsByYear, nightsByMonth);
    expect(n).toBe(3650);
  });
});
