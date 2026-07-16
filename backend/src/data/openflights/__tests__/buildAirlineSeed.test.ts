import { buildAirlineSeed } from "../buildAirlineSeed";
import { AIRLINES } from "../../airlines";

const RAW = `5,"Lufthansa GmbH","\\N","LH","LHX","C","Germany","Y"
6,"Swiss International Air Lines","\\N","LX","SWR","C","Switzerland","Y"`;

describe("buildAirlineSeed", () => {
  it("lets the curated list win on name + icao for a shared IATA", () => {
    const seed = buildAirlineSeed(RAW);
    const lh = seed.find((r) => r.iata === "LH");
    // curated airlines.ts has { iata:"LH", icao:"DLH", name:"Lufthansa" }
    expect(lh?.name).toBe("Lufthansa");
    expect(lh?.icao).toBe("DLH");
  });

  it("includes every curated IATA code", () => {
    const seed = buildAirlineSeed(RAW);
    const seedIatas = new Set(seed.map((r) => r.iata));
    for (const a of AIRLINES) expect(seedIatas.has(a.iata)).toBe(true);
  });

  it("keeps OpenFlights-only carriers not in the curated list", () => {
    const seed = buildAirlineSeed(RAW);
    // LX is curated too, so add an OpenFlights-only code to prove passthrough
    const raw2 = RAW + `\n9,"Qantas","\\N","QF","QFA","C","Australia","Y"`;
    const seed2 = buildAirlineSeed(raw2);
    expect(seed2.some((r) => r.iata === "QF")).toBe(true);
  });

  it("produces no duplicate IATA codes", () => {
    const seed = buildAirlineSeed(RAW);
    const iatas = seed.map((r) => r.iata);
    expect(new Set(iatas).size).toBe(iatas.length);
  });
});
