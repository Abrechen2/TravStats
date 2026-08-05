import { AIRCRAFT_TYPES } from "../aircraftTypes";

describe("AIRCRAFT_TYPES data integrity", () => {
  it("has no duplicate ICAO codes", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const t of AIRCRAFT_TYPES) {
      if (seen.has(t.icao)) dupes.push(`${t.icao}: "${seen.get(t.icao)}" vs "${t.name}"`);
      seen.set(t.icao, t.name);
    }
    expect(dupes).toEqual([]);
  });

  it("uses 2-4 character ICAO type designators (ICAO Doc 8643 range)", () => {
    const bad = AIRCRAFT_TYPES.filter((t) => !/^[A-Z0-9]{2,4}$/.test(t.icao));
    expect(bad.map((t) => t.icao)).toEqual([]);
  });
});
