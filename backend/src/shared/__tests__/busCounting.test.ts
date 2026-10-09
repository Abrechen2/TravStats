import {
  busCountries,
  busDayKeys,
  busYear,
  countableBusWhere,
  isCountableBus,
} from "../busCounting";

/** The truth table `frontend/src/shared/__tests__/busCounting.test.ts` mirrors. */
describe("busCounting", () => {
  it.each([
    ["completed", true],
    ["scheduled", false],
    ["in_progress", false],
    ["cancelled", false],
  ])("%s counts: %s", (status, counts) => {
    expect(isCountableBus({ status })).toBe(counts);
  });

  it("the where fragment names only completed", () => {
    expect(countableBusWhere()).toEqual({ status: { in: ["completed"] } });
  });

  it("files a ride under the year it LEFT on the terminal's calendar", () => {
    // 31 Dec 23:30 in Seoul is 14:30 UTC the same day; 1 Jan 00:30 Seoul is 31 Dec 15:30 UTC.
    const ride = {
      departureTime: new Date("2025-12-31T15:30:00Z"),
      arrivalTime: new Date("2025-12-31T18:00:00Z"),
      depTimezone: "Asia/Seoul",
      arrTimezone: "Asia/Seoul",
    };
    expect(busYear(ride)).toBe(2026);
    expect(busDayKeys(ride)).toEqual(["2026-01-01"]);
  });

  it("an overnight ride is active on both terminals' days", () => {
    const ride = {
      departureTime: new Date("2026-03-01T21:00:00Z"), // 22:00 Berlin
      arrivalTime: new Date("2026-03-02T06:00:00Z"), // 07:00 Berlin
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
    };
    expect(busDayKeys(ride)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("a ride without an arrival is a one-day event", () => {
    expect(
      busDayKeys({
        departureTime: new Date("2026-03-01T21:00:00Z"),
        arrivalTime: null,
        depTimezone: "Europe/Berlin",
        arrTimezone: null,
      })
    ).toEqual(["2026-03-01"]);
  });

  it("proves both terminals' countries, upper-cased, never guessed", () => {
    expect(busCountries({ depCountry: "kr", arrCountry: "KR" })).toEqual(["KR"]);
    expect(busCountries({ depCountry: "DE", arrCountry: null })).toEqual(["DE"]);
    expect(busCountries({ depCountry: "Germany", arrCountry: null })).toEqual([]);
  });
});
