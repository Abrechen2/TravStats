import { airportDisplayName } from "../utils/airportDisplay";

/**
 * The rows below are the real catalogue, read out of the seeded airports table
 * on 2026-09-13 — not invented examples. `city` is carried in each case only to
 * show what the "next up" strip used to print (#332).
 */
describe("airportDisplayName", () => {
  const CATALOGUE = [
    {
      iata: "MXP",
      city: "Ferno (VA)",
      name: "Milan Malpensa International Airport",
      expected: "Milan Malpensa",
    },
    {
      iata: "BGY",
      city: "Orio al Serio (BG)",
      name: "Milan Bergamo Airport / Antonio Locatelli Air Base",
      expected: "Milan Bergamo",
    },
    {
      iata: "CDG",
      city: "Paris (Roissy-en-France, Val-d'Oise)",
      name: "Charles de Gaulle International Airport",
      expected: "Charles de Gaulle",
    },
    {
      iata: "HHN",
      city: "Frankfurt am Main (Lautzenhausen)",
      name: "Frankfurt-Hahn Airport",
      expected: "Frankfurt-Hahn",
    },
    { iata: "LHR", city: "London", name: "London Heathrow Airport", expected: "London Heathrow" },
    { iata: "NRT", city: "Narita", name: "Narita International Airport", expected: "Narita" },
  ];

  it.each(CATALOGUE)(
    "names $iata after the airport, not the municipality",
    ({ name, expected }) => {
      expect(airportDisplayName({ name })).toBe(expected);
    }
  );

  it("does not print the municipality a tester complained about", () => {
    // The regression itself: the strip read "Ferno" on a flight to Milan.
    expect(airportDisplayName({ name: "Milan Malpensa International Airport" })).not.toContain(
      "Ferno"
    );
  });

  it("prefers the served city when AeroDataBox has backfilled one", () => {
    expect(
      airportDisplayName({
        name: "Milan Malpensa International Airport",
        municipalityName: "Milan",
      })
    ).toBe("Milan");
  });

  it("ignores a blank municipality rather than returning an empty name", () => {
    expect(airportDisplayName({ name: "London Heathrow Airport", municipalityName: "   " })).toBe(
      "London Heathrow"
    );
  });

  it("keeps a name that is nothing but the generic words", () => {
    // Shortening "Airport" would leave an empty label, which reads as missing
    // data rather than as an airport.
    expect(airportDisplayName({ name: "Airport" })).toBe("Airport");
    expect(airportDisplayName({ name: "International Airport" })).toBe("International Airport");
  });

  it("abstains when the row carries no name at all, so the caller can fall back to the code", () => {
    expect(airportDisplayName({ name: "" })).toBeNull();
    expect(airportDisplayName({ name: null })).toBeNull();
    expect(airportDisplayName(undefined)).toBeNull();
    expect(airportDisplayName(null)).toBeNull();
  });
});
