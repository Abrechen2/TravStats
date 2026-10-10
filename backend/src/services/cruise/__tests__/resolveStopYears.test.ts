import { describe, it, expect } from "@jest/globals";
import { resolveStopYears } from "../v2Cruise";

/**
 * forgejo#124: an itinerary that prints its days without a year is dated from
 * the voyage's start — over New Year into the next — and nothing is dated when
 * there is no start to date it from.
 */
describe("resolveStopYears", () => {
  it("takes the start's year and rolls over the year boundary", () => {
    expect(resolveStopYears(["--12-30", "--12-31", "--01-01", "--01-03"], "2026-12-30")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-03",
    ]);
  });

  it("keeps full dates as printed and dates the year-less ones after them", () => {
    expect(resolveStopYears(["2027-06-01", "--06-02", null, "--06-04"], null)).toEqual([
      "2027-06-01",
      "2027-06-02",
      null,
      "2027-06-04",
    ]);
  });

  it("abstains without a start date — no year is guessed", () => {
    expect(resolveStopYears(["--06-01", "--06-02"], null)).toEqual([null, null]);
    expect(resolveStopYears(["--06-01"], "bald")).toEqual([null]);
  });

  it("drops a 29 February the inferred year does not have", () => {
    expect(resolveStopYears(["--02-28", "--02-29"], "2027-02-28")).toEqual(["2027-02-28", null]);
    expect(resolveStopYears(["--02-29"], "2028-02-27")).toEqual(["2028-02-29"]);
  });
});
