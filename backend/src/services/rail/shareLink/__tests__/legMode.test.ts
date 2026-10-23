import { classifyLegMode, type LegTransit } from "../legMode";
import { ALEX_PRODUCT_CODES } from "./fixtures/dbConnectionAnswer";

const rail: LegTransit = { mode: "rail", busKind: null };
const metro: LegTransit = { mode: "metro", busKind: null };
const tram: LegTransit = { mode: "tram", busKind: null };
const ferry: LegTransit = { mode: "ferry", busKind: null };
const unknown: LegTransit = { mode: "unknown", busKind: null };
const city: LegTransit = { mode: "bus", busKind: "city" };
const replacement: LegTransit = { mode: "bus", busKind: "replacement" };
const coach: LegTransit = { mode: "bus", busKind: "coach" };

describe("classifyLegMode — the HAFAS category codes of a real answer's product list", () => {
  const EXPECTED: Record<string, LegTransit> = {
    Bsv: replacement,
    BSV: replacement,
    Bus: city,
    BUS: city,
    OBU: city,
    STR: tram,
    Str: tram,
    stR: tram,
    Stb: tram,
    stb: tram,
    U: metro,
    u: metro,
    ubu: metro,
    // `lt` is in bahn.de's list without a meaning anyone could check: not guessed.
    lt: unknown,
  };

  it.each([...ALEX_PRODUCT_CODES])("classifies %s", (code) => {
    expect(classifyLegMode({ categoryCode: code })).toEqual(EXPECTED[code] ?? rail);
  });

  it("covers every code the product list names", () => {
    expect(ALEX_PRODUCT_CODES.length).toBeGreaterThan(50);
    expect(ALEX_PRODUCT_CODES.map((c) => classifyLegMode({ categoryCode: c }).mode)).not.toContain(
      undefined
    );
  });
});

describe("classifyLegMode — the printed name, when nothing structured is stated", () => {
  it.each<[string, LegTransit]>([
    ["U 3", metro],
    ["U3", metro],
    ["STR 12", tram],
    ["Str 6", tram],
    ["Tram 19", tram],
    ["Bus 100", city],
    ["BUS 54", city],
    ["Bus SEV", replacement],
    ["SEV/Bus RE 5", replacement],
    ["S1", rail],
    ["S 8", rail],
    ["RE 5", rail],
    ["RB 57031", rail],
    ["ICE 578", rail],
    ["IC 2013", rail],
    ["EC 115", rail],
    ["FEX", rail],
    ["57031", rail],
    ["FLX 1234", unknown],
    ["Seilbahn 1", unknown],
  ])("reads %s", (printedName, expected) => {
    expect(classifyLegMode({ printedName })).toEqual(expected);
  });

  it("knows a coach and a ferry when they are named", () => {
    expect(classifyLegMode({ category: "Fernbus", printedName: "Fernbus 042" })).toEqual(coach);
    expect(classifyLegMode({ categoryCode: "Schiff" })).toEqual(ferry);
  });

  it("is unknown when nothing names the vehicle", () => {
    expect(classifyLegMode({})).toEqual(unknown);
  });
});

describe("classifyLegMode — structured facts win over the printed name", () => {
  it("prefers the web client's product group, either spelling", () => {
    expect(classifyLegMode({ productGroup: "TRAM", printedName: "RE 5" })).toEqual(tram);
    expect(classifyLegMode({ productGroup: "STRASSENBAHN", printedName: "RE 5" })).toEqual(tram);
    expect(classifyLegMode({ productGroup: "UBAHN", printedName: "57031" })).toEqual(metro);
    expect(classifyLegMode({ productGroup: "BUSSE", printedName: "U 3" })).toEqual(city);
    expect(classifyLegMode({ productGroup: "REGIONAL", printedName: "Bus 5" })).toEqual(rail);
  });

  it("prefers the recon's category code over the printed category", () => {
    expect(classifyLegMode({ categoryCode: "DBS", category: "Bus", printedName: "Bus 1" })).toEqual(
      rail
    );
    expect(classifyLegMode({ categoryCode: "Str", printedName: "12" })).toEqual(tram);
  });

  it("still reads a replacement bus the data calls a bus", () => {
    expect(classifyLegMode({ productGroup: "BUS", printedName: "Bus SEV" })).toEqual(replacement);
  });

  it("falls through an unknown product group to what is printed", () => {
    expect(classifyLegMode({ productGroup: "ANRUFPFLICHTIG", printedName: "Bus 9" })).toEqual(city);
  });
});
