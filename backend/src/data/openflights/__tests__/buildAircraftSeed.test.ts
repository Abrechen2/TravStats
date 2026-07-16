import { buildAircraftSeed } from "../buildAircraftSeed";
import { AIRCRAFT_TYPES } from "../../aircraftTypes";

const RAW = `"Airbus A320","320","A320"
"ATR 72","AT7","AT72"
"Weird Craft","\\N","\\N"`;

describe("buildAircraftSeed", () => {
  it("keeps the curated name on an ICAO shared with OpenFlights", () => {
    const seed = buildAircraftSeed(RAW);
    const a320 = seed.find((r) => r.icao === "A320");
    expect(a320?.name).toBe("Airbus A320"); // curated name
  });

  it("adds OpenFlights ICAO codes absent from the curated list", () => {
    const seed = buildAircraftSeed(RAW);
    // AT72 is curated already; assert an OF-only code passes through
    const raw2 = RAW + `\n"Boeing 707","703","B703"`;
    const seed2 = buildAircraftSeed(raw2);
    expect(seed2.some((r) => r.icao === "B703")).toBe(true);
  });

  it("drops rows without a 2-4 char ICAO", () => {
    const seed = buildAircraftSeed(RAW);
    expect(seed.every((r) => /^[A-Z0-9]{2,4}$/.test(r.icao))).toBe(true);
  });

  it("includes every curated aircraft ICAO", () => {
    const seed = buildAircraftSeed(RAW);
    const seedIcaos = new Set(seed.map((r) => r.icao));
    for (const t of AIRCRAFT_TYPES) expect(seedIcaos.has(t.icao)).toBe(true);
  });

  it("produces no duplicate ICAO codes", () => {
    const seed = buildAircraftSeed(RAW);
    const icaos = seed.map((r) => r.icao);
    expect(new Set(icaos).size).toBe(icaos.length);
  });
});
