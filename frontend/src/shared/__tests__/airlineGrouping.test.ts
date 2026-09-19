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
  // forgejo#49: the same groups reach this function from two places — the
  // `/stats/airlines` route via a Prisma `groupBy`, and `/stats/page` from the
  // loaded rows — and those arrive in different orders. A label picked by
  // frequency alone therefore depended on the feed order whenever two spellings
  // were equally common, so one carrier had two names depending on which
  // endpoint drew it. The tie-break is alphabetical.
  it("names an equally-spelled group the same way whichever order the rows arrive in", () => {
    const rows = [
      { airline: "Zephyr Air", count: 2 },
      { airline: "Aero Zephyr", count: 2 },
    ];
    const forward = groupAirlines(rows, catalogue);
    const reversed = groupAirlines([...rows].reverse(), catalogue);

    // TWO groups here, one per spelling: neither is in the catalogue, so each
    // keys on its own normalised name. What is being pinned is the ORDER, which
    // `groups.sort` already tie-breaks on the label; the case below pins the
    // label of a single group, which is where the new tie-break bites.
    expect(forward.groups.map((g) => g.label)).toEqual(["Aero Zephyr", "Zephyr Air"]);
    expect(reversed.groups.map((g) => g.label)).toEqual(forward.groups.map((g) => g.label));
  });

  it("picks the alphabetically first of two equally common spellings of ONE carrier", () => {
    // Both rows carry the same code, so they are ONE group whose label falls
    // back to a spelling — the catalogue below does not name "ZZ".
    const rows = [
      { airline: "Zephyr Air", airlineIata: "ZZ", count: 2 },
      { airline: "Aero Zephyr", airlineIata: "ZZ", count: 2 },
    ];
    const forward = groupAirlines(rows, catalogue);
    const reversed = groupAirlines([...rows].reverse(), catalogue);

    expect(forward.groups).toHaveLength(1);
    expect(forward.groups[0].label).toBe("Aero Zephyr");
    expect(reversed.groups[0].label).toBe("Aero Zephyr");
  });
});
