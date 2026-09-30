import { describe, expect, it } from "@jest/globals";

import { airportCityName } from "../../../utils/airportDisplay";
import { stationCity } from "../loadTransport";

/**
 * Acceptance D10 (2026-09-26): trip suggestions were named after airports —
 * "Josep Tarradellas Barcelona-El Prat", "Copenhagen Kastrup" — where the
 * reader expects the city. The rows are the seeded catalogue's own.
 */
describe("airportCityName — the city an airport serves", () => {
  it.each([
    ["BCN", "Barcelona", "Josep Tarradellas Barcelona-El Prat Airport", "Barcelona"],
    ["CPH", "Copenhagen", "Copenhagen Kastrup Airport", "Copenhagen"],
    [
      "CDG",
      "Paris (Roissy-en-France, Val-d'Oise)",
      "Charles de Gaulle International Airport",
      "Paris",
    ],
    ["JFK", "New York", "John F Kennedy International Airport", "New York"],
  ])("%s serves %s", (_iata, city, name, expected) => {
    expect(airportCityName({ city, name })).toBe(expected);
  });

  it("never names the town the runway lies in (MXP 'Ferno (VA)')", () => {
    expect(
      airportCityName({ city: "Ferno (VA)", name: "Milan Malpensa International Airport" })
    ).toBeNull();
    expect(airportCityName({ city: "Orio al Serio (BG)", name: "Orio al Serio Airport" })).toBe(
      "Orio al Serio"
    );
  });

  it("prefers the served city a lookup filled in", () => {
    expect(
      airportCityName({
        city: "Ferno (VA)",
        name: "Milan Malpensa International Airport",
        municipalityName: "Milan",
      })
    ).toBe("Milan");
  });
});

describe("stationCity — a station names its city first", () => {
  it.each([
    ["Roma Termini", "Roma"],
    ["München Hbf", "München"],
    ["Frankfurt(Main)Hbf", "Frankfurt"],
    ["Paris Gare de Lyon", "Paris"],
    ["Zürich HB", "Zürich"],
    ["Basel SBB", "Basel"],
    ["Wien Hauptbahnhof", "Wien"],
  ])("%s → %s", (station, city) => {
    expect(stationCity(station)).toBe(city);
  });
});
