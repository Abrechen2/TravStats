import { describe, it, expect } from "vitest";
import { airlineGroupKey, groupAirlines, type AirlineResolvers } from "../airlineNormalize";

// forgejo#81 — mirror of the backend test: same code, same airline.
const catalogue: AirlineResolvers = {
  iataForName: (name) => {
    const n = name.trim().toLowerCase();
    if (n === "swiss" || n === "swiss international air lines") return "LX";
    if (n === "lot" || n === "lot polish airlines" || n === "lot - polish airlines") return "LO";
    if (n === "lufthansa") return "LH";
    return undefined;
  },
  iataForIcao: (icao) => ({ SWR: "LX", LOT: "LO", DLH: "LH" })[icao],
  nameForIata: (iata) => ({ LX: "SWISS", LO: "LOT Polish Airlines", LH: "Lufthansa" })[iata],
};

describe("airlineGroupKey", () => {
  it("groups Swiss and SWISS under LX when the IATA column is set", () => {
    expect(airlineGroupKey({ airline: "Swiss", airlineIata: "LX" }, catalogue)).toBe("iata:LX");
    expect(airlineGroupKey({ airline: "SWISS", airlineIata: "lx" }, catalogue)).toBe("iata:LX");
  });

  it("resolves the code from the ICAO column, then from the name, before giving up", () => {
    expect(airlineGroupKey({ airline: null, airlineIcao: "SWR" }, catalogue)).toBe("iata:LX");
    expect(airlineGroupKey({ airline: "Swiss" }, catalogue)).toBe("iata:LX");
  });

  it('collapses "LOT - Polish Airlines" and "LOT" into one carrier', () => {
    expect(airlineGroupKey({ airline: "LOT - Polish Airlines" }, catalogue)).toBe(
      airlineGroupKey({ airline: "LOT" }, catalogue)
    );
  });

  it("falls back to the normalised name only when no catalogue knows the carrier", () => {
    expect(airlineGroupKey({ airline: "Air Nowhere " }, catalogue)).toBe("name:air nowhere");
    expect(airlineGroupKey({ airline: "AIR NOWHERE" }, catalogue)).toBe("name:air nowhere");
  });

  it('keys a row that names no airline as null — it is not a carrier called ""', () => {
    expect(airlineGroupKey({ airline: null }, catalogue)).toBeNull();
    expect(airlineGroupKey({ airline: "   " }, catalogue)).toBeNull();
  });
});

describe("groupAirlines", () => {
  it("returns one group per code, named by the catalogue, and says how many rows had none", () => {
    const { groups, withoutAirline } = groupAirlines(
      [
        { airline: "Swiss", airlineIata: "LX", count: 3 },
        { airline: "SWISS", count: 2 },
        { airline: "LOT - Polish Airlines", count: 1 },
        { airline: "LOT", count: 1 },
        { airline: null, count: 4 },
        { airline: "Air Nowhere", count: 1 },
      ],
      catalogue
    );

    expect(groups.map((g) => [g.label, g.count, g.iata])).toEqual([
      ["SWISS", 5, "LX"],
      ["LOT Polish Airlines", 2, "LO"],
      ["Air Nowhere", 1, null],
    ]);
    expect(withoutAirline).toBe(4);
  });
});
