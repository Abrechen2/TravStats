import { describe, expect, it } from "vitest";
import { primaryOperator } from "../primaryOperator";

type Leg = Parameters<typeof primaryOperator>[0][number];

/** A leg along the equator: one degree of longitude is ~111.2 km. */
const leg = (operator: string | null, distanceKm: number | null, degrees = 1): Leg => ({
  operator,
  distanceKm,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: degrees,
});

// forgejo#197: a grouped ride is shown under the operator that carried it furthest.
describe("primaryOperator — truth table", () => {
  it.each<[string, Leg[], string | null]>([
    ["no legs", [], null],
    ["one leg", [leg("DB Fernverkehr", 200)], "DB Fernverkehr"],
    ["no leg names an operator", [leg(null, 100), leg("  ", 300)], null],
    ["the longer leg wins", [leg("DB Regio", 60), leg("Thalys", 260)], "Thalys"],
    [
      "a later longer leg wins over the first",
      [leg("Thalys", 60), leg("DB Regio", 70)],
      "DB Regio",
    ],
    [
      "an operator's legs are summed",
      [leg("DB Regio", 80), leg("SNCF", 120), leg("DB Regio", 50)],
      "DB Regio",
    ],
    [
      "names match ignoring case and space",
      [leg("ÖBB", 50), leg("öbb ", 50), leg("SBB", 90)],
      "ÖBB",
    ],
    ["a tie goes to the operator met first", [leg("SBB", 100), leg("ÖBB", 100)], "SBB"],
    ["a leg without an operator counts for nobody", [leg(null, 900), leg("RE", 10)], "RE"],
    [
      "an unknown distance falls back to the straight line",
      [leg("Thalys", null, 3), leg("DB Regio", 300)],
      "Thalys",
    ],
  ])("%s", (_name, legs, expected) => {
    expect(primaryOperator(legs)).toBe(expected);
  });

  it("returns the first leg's spelling of a matched operator", () => {
    expect(primaryOperator([leg("db regio", 10), leg("DB Regio", 10)])).toBe("db regio");
  });
});
