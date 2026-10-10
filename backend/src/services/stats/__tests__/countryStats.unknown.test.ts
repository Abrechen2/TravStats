import { countriesTouchedBy, UNKNOWN_COUNTRY } from "../countryStats";

/**
 * forgejo#256 — both ends of a flight count the same way in the country
 * distribution: an end with a code is its catalogue country, else Unknown; an
 * end with no code counts nowhere. A departure without a code used to count
 * as Unknown while an arrival without one was dropped, and an empty IATA code
 * did not fall back to the ICAO code.
 */
const catalogue = new Map([
  ["FRA", { country: "DE" }],
  ["EGLL", { country: "GB" }],
]);
const row = (depIata: string | null, arrIata: string | null, arrIcao: string | null = null) => ({
  depIata,
  depIcao: null,
  arrIata,
  arrIcao,
});

describe("countriesTouchedBy", () => {
  it("treats a missing code the same at either end: no evidence, no country", () => {
    expect([...countriesTouchedBy(row("FRA", null), catalogue)]).toEqual(["DE"]);
    expect([...countriesTouchedBy(row(null, "FRA"), catalogue)]).toEqual(["DE"]);
  });

  it("counts a code the catalogue cannot place as Unknown, at either end", () => {
    expect([...countriesTouchedBy(row("XXX", "FRA"), catalogue)].sort()).toEqual(
      ["DE", UNKNOWN_COUNTRY].sort()
    );
    expect([...countriesTouchedBy(row("FRA", "XXX"), catalogue)].sort()).toEqual(
      ["DE", UNKNOWN_COUNTRY].sort()
    );
  });

  it("falls back from an empty IATA code to the ICAO code", () => {
    expect([...countriesTouchedBy(row("FRA", "", "EGLL"), catalogue)].sort()).toEqual(["DE", "GB"]);
  });

  it("counts a flight with two unknown ends as ONE Unknown visit", () => {
    expect([...countriesTouchedBy(row("YYY", "XXX"), catalogue)]).toEqual([UNKNOWN_COUNTRY]);
  });
});
