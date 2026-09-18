import { describe, it, expect } from "vitest";

import { flightSummaryFigures } from "../flightSummaryFigures";
import type { AirlineResolvers } from "../../../shared/airlineNormalize";

/**
 * The airline figure is the one that can leave rows out, and it must say so:
 * the table derives a carrier from the flight number so a logo can appear,
 * while the count counts the airlines a row records. Measured on
 * 2.7.0-beta.1: two brands visible in the rows, "1 AIRLINES" in the header.
 */
const resolvers: AirlineResolvers = {
  iataForName: (name) => (name.toUpperCase() === "LUFTHANSA" ? "LH" : null),
  iataForIcao: (icao) => (icao.toUpperCase() === "DLH" ? "LH" : null),
  nameForIata: (iata) => (iata.toUpperCase() === "LH" ? "Lufthansa" : null),
};

const labels = {
  flights: "Flüge",
  airlines: "Airlines",
  airports: "Flughäfen",
  withoutAirline: (count: number) => `+${count} ohne Angabe`,
};

const figure = (rows: Parameters<typeof flightSummaryFigures>[0], key: string) =>
  flightSummaryFigures(rows, resolvers, labels).find((f) => f.key === key);

describe("flightSummaryFigures", () => {
  it("counts rows, distinct airlines and distinct airports off the visible rows", () => {
    const rows = [
      { airline: "Lufthansa", depIata: "FRA", arrIata: "JFK" },
      { airline: null, airlineIcao: "DLH", depIata: "JFK", arrIata: "FRA" },
      { airline: "Swiss", depIata: "ZRH", arrIata: "FRA" },
    ];
    expect(figure(rows, "flights")?.value).toBe("3");
    // The first two are one carrier: the code is the identity, not the spelling.
    expect(figure(rows, "airlines")?.value).toBe("2");
    expect(figure(rows, "airports")?.value).toBe("3");
  });

  it("says how many rows record no airline at all", () => {
    const rows = [
      { airline: "Lufthansa", depIata: "FRA", arrIata: "JFK" },
      { airline: null, depIata: "MUC", arrIata: "HAM" },
      { airline: null, depIata: "HAM", arrIata: "MUC" },
    ];
    const airlines = figure(rows, "airlines");
    expect(airlines?.value).toBe("1");
    expect(airlines?.note).toBe("+2 ohne Angabe");
  });

  it("stays silent when every row records its carrier", () => {
    const rows = [{ airline: "Lufthansa", depIata: "FRA", arrIata: "JFK" }];
    expect(figure(rows, "airlines")?.note).toBeUndefined();
  });

  it("counts an airport once however often it is flown", () => {
    const rows = [
      { airline: "Lufthansa", depIata: "FRA", arrIata: "MUC" },
      { airline: "Lufthansa", depIata: "MUC", arrIata: "FRA" },
    ];
    expect(figure(rows, "airports")?.value).toBe("2");
  });

  it("reports zeroes for an empty list without a note", () => {
    expect(figure([], "flights")?.value).toBe("0");
    expect(figure([], "airlines")?.note).toBeUndefined();
  });
});
