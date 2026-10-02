import { describe, it, expect } from "vitest";

import { flightSummaryFigures, flightSummaryFiguresFromCounts } from "../flightSummaryFigures";
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

/** Count-aware, like `t()` with `{ count }` — the singular is the point of forgejo#160. */
const labels = {
  flights: (count: number) => (count === 1 ? "Flug" : "Flüge"),
  airlines: (count: number) => (count === 1 ? "Airline" : "Airlines"),
  airports: (count: number) => (count === 1 ? "Flughafen" : "Flughäfen"),
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

/**
 * forgejo#160 — "1 Flüge · 1 Airlines". Each label is handed the number it
 * stands beside, so the translation can pick the singular; a label resolved
 * once without a count cannot.
 */
describe("summary labels agree with their own figure (forgejo#160)", () => {
  it("names one flight, one airline and two airports each in its own number", () => {
    const rows = [{ airline: "Lufthansa", depIata: "MUC", arrIata: "CDG" }];
    expect(figure(rows, "flights")?.label).toBe("Flug");
    expect(figure(rows, "airlines")?.label).toBe("Airline");
    expect(figure(rows, "airports")?.label).toBe("Flughäfen");
  });

  it("does the same off the server's counts", () => {
    const figures = flightSummaryFiguresFromCounts(
      { flights: 1, airlines: 1, airports: 2, withoutAirline: 0 },
      labels
    );
    expect(figures.map((f) => `${f.value} ${f.label}`)).toEqual([
      "1 Flug",
      "1 Airline",
      "2 Flughäfen",
    ]);
  });
});
