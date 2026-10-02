import { TRANSFORMS } from "../types";
import { applyTemplate } from "../engine";
import type { AirlineTemplate } from "../types";

/**
 * The transform extensions the archive templates (Germanwings, Emirates,
 * Air Berlin) need, and the promise that comes with them: every form the
 * engine read before reads exactly as before.
 */
describe("parseIso — the forms it already read stay identical", () => {
  it.each([
    ["2025-01-16T07:55", "2025-01-16T07:55"],
    ["18 Sep 2025T07:25", "2025-09-18T07:25"],
    ["18 Sep 2025", "2025-09-18T00:00"],
    ["18. Dezember 2024 16:05", "2024-12-18T16:05"],
    ["23.05.2025T12:25", "2025-05-23T12:25"],
    ["23.05.2025", "2025-05-23T00:00"],
    ["not a date", "not a date"],
  ])("%s", (raw, expected) => {
    expect(TRANSFORMS.parseIso(raw)).toBe(expected);
  });
});

describe("parseIso — two-digit years and German short months", () => {
  it.each([
    // Emirates 2014: "Mo 17-Feb-14 09:10"
    ["17-Feb-14T09:10", "2014-02-17T09:10"],
    // Emirates spells March the German way, and an unknown month used to
    // fall back to January — a flight on 1 March read as 1 January.
    ["03-Mrz-14T07:40", "2014-03-03T07:40"],
    ["03-Mär-14T07:40", "2014-03-03T07:40"],
    // Emirates 2018+: "12. Aug. 23" with the time before it
    ["12. Aug. 23T21:05", "2023-08-12T21:05"],
    ["27. Sep. 23T11:45", "2023-09-27T11:45"],
    ["05. Nov. 27T06:00", "2027-11-05T06:00"],
  ])("%s", (raw, expected) => {
    expect(TRANSFORMS.parseIso(raw)).toBe(expected);
  });

  it("reads 'Mrz' in the four-digit form too, instead of filing March under January", () => {
    expect(TRANSFORMS.parseIso("03 Mrz 2014T07:40")).toBe("2014-03-03T07:40");
  });

  it("refuses a day the calendar does not have rather than inventing one", () => {
    expect(TRANSFORMS.parseIso("31-Feb-14T07:40")).toBe("31-Feb-14T07:40");
  });
});

describe("airportName", () => {
  it.each([
    ["München", "MUC"],
    ["Köln-Bonn", "CGN"],
    ["Cologne/Bonn", "CGN"],
    ["Berlin-Tegel", "TXL"],
    ["Berlin - Tegel", "TXL"],
    ["Berlin-Schönefeld", "SXF"],
    ["Mailand Malpensa", "MXP"],
    ["DUS", "DUS"],
  ])("%s → %s", (name, code) => {
    expect(TRANSFORMS.airportName(name)).toBe(code);
  });

  it("names no airport for a city with several — a 2008 flight to Berlin did not land at BER", () => {
    expect(TRANSFORMS.airportName("Berlin")).toBe("");
    expect(TRANSFORMS.airportName("Mailand")).toBe("");
  });

  it("names no airport for a name it does not know", () => {
    expect(TRANSFORMS.airportName("Musterhausen")).toBe("");
  });
});

describe("the engine and an empty transform result", () => {
  const template: AirlineTemplate = {
    airline: "Test",
    iata: "ZZ",
    version: "1",
    from: [],
    subject: [],
    selectors: {},
    textPatterns: {
      flightNumber: ["Flug (ZZ\\d+)"],
      departureCode: ["ab ([A-Za-z]+)"],
      arrivalCode: ["an ([A-Za-z]+)"],
    },
    transforms: { departureCode: "airportName", arrivalCode: "airportName" },
    testCases: [],
  };

  it("reports a code the transform could not place as missing, never as an empty string", () => {
    const r = applyTemplate(template, "Flug ZZ12 ab Musterhausen an Hamburg", "");
    expect(r.departureCode).toBeUndefined();
    expect(r.missing).toContain("departureCode");
    expect(r.arrivalCode).toBe("HAM");
  });
});
