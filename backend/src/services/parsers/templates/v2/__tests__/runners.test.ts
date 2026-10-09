import { describe, it, expect } from "@jest/globals";
import { validateEnvelope, type TemplateEnvelope } from "../envelope";
import {
  applyTemplate,
  defaultRunners,
  firstDifference,
  matchOnlyRunner,
  runTestCases,
} from "../runners";
import { tourOperatorTemplate, TOUR_INVOICE } from "./tourOperatorFixture";
import { validTemplate } from "./fixtures";

function valid(raw: unknown): TemplateEnvelope {
  const result = validateEnvelope(raw);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.template;
}

describe("v2 extraction runner", () => {
  it("a tour-operator invoice is read end to end", () => {
    const template = valid(tourOperatorTemplate());
    const result = applyTemplate(template, TOUR_INVOICE);
    expect(result.missing).toEqual([]);
    expect(result.matched).toBe(true);
    expect(result.values).toEqual({
      bookingNumber: "SW-482913",
      issuedOn: "2026-03-02",
      total: 3249,
      currency: "EUR",
      operator: "Sonnenweg Reisen",
      flights: [
        {
          from: "FRA",
          to: "ADD",
          flightNumber: "ET707",
          date: "2026-05-18",
          departs: "21:35",
          arrives: "06:25",
          arrivalDayOffset: 1,
        },
        {
          from: "ADD",
          to: "NBO",
          flightNumber: "ET308",
          date: "2026-05-19",
          departs: "08:40",
          arrives: "10:55",
          arrivalDayOffset: 0,
        },
        {
          from: "NBO",
          to: "ADD",
          flightNumber: "ET309",
          date: "2026-05-30",
          departs: "12:00",
          arrives: "14:10",
          arrivalDayOffset: 0,
        },
        {
          from: "ADD",
          to: "FRA",
          flightNumber: "ET706",
          date: "2026-05-30",
          departs: "23:15",
          arrives: "05:50",
          arrivalDayOffset: 1,
        },
      ],
      stays: [
        {
          checkIn: "2026-05-19",
          checkOut: "2026-05-23",
          name: "Savanna Example Lodge",
          address: "Parkweg 7, Beispielort, Kenia",
        },
        {
          checkIn: "2026-05-23",
          checkOut: "2026-05-30",
          name: "Hotel Seeblick Muster",
          address: "Uferweg 12, Musterhausen, Kenia",
        },
      ],
    });
  });

  it("its own test cases pass, including the partial `expected`", () => {
    expect(runTestCases(valid(tourOperatorTemplate()), defaultRunners)).toEqual({ kind: "passed" });
  });

  it("a match case whose `expected` disagrees fails and names the first differing path", () => {
    const raw = tourOperatorTemplate();
    const broken = {
      ...raw,
      testCases: raw.testCases.map((c) =>
        c.expect === "match"
          ? { ...c, expected: { total: 3249, flights: [{}, { to: "MBA" }, {}, {}] } }
          : c
      ),
    };
    expect(runTestCases(valid(broken), defaultRunners)).toEqual({
      kind: "failed",
      failures: ['"the invoice is read": expected.flights[1].to: expected "MBA", got "NBO"'],
    });
  });

  it("a wrong item count is reported as a length difference", () => {
    const raw = tourOperatorTemplate();
    const broken = {
      ...raw,
      testCases: raw.testCases.map((c) =>
        c.expect === "match" ? { ...c, expected: { stays: [{}] } } : c
      ),
    };
    expect(runTestCases(valid(broken), defaultRunners)).toEqual({
      kind: "failed",
      failures: ['"the invoice is read": expected.stays.length: expected 1, got 2'],
    });
  });

  it("matcher accepts but a required value is missing: decline, and the failure says what", () => {
    const raw = tourOperatorTemplate();
    const withoutTotal = TOUR_INVOICE.replace(/Gesamtpreis.*$/m, "");
    const broken = {
      ...raw,
      testCases: [
        { name: "no total", input: withoutTotal, expect: "match" as const },
        ...raw.testCases.filter((c) => c.expect === "decline"),
      ],
    };
    expect(applyTemplate(valid(broken), withoutTotal)).toMatchObject({
      matched: false,
      missing: ["total", "currency"],
    });
    expect(runTestCases(valid(broken), defaultRunners)).toEqual({
      kind: "failed",
      failures: ['"no total": expected match, got decline (missing: total, currency)'],
    });
  });

  it("when the matcher declines, nothing is extracted", () => {
    const template = valid(tourOperatorTemplate());
    expect(applyTemplate(template, "Gesamtpreis: 3.249,00 EUR")).toEqual({
      matched: false,
      values: {},
      missing: [],
    });
  });

  it("a runner that reports no values fails a case that carries `expected`", () => {
    const template = valid(tourOperatorTemplate());
    const run = runTestCases(template, new Map([["package", matchOnlyRunner]]));
    expect(run).toEqual({
      kind: "failed",
      failures: ['"the invoice is read": this runner cannot check expected values'],
    });
  });

  it("the P1 fixture still passes under the extraction runner", () => {
    expect(runTestCases(valid(validTemplate()), defaultRunners)).toEqual({ kind: "passed" });
  });

  it("an extraction that does not validate rejects the envelope", () => {
    const result = validateEnvelope({
      ...tourOperatorTemplate(),
      extraction: { fields: { a: { patterns: ["("] } } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]).toMatch(/^extraction\.fields\.a\.patterns\.0: invalid regex/);
  });
});

describe("firstDifference", () => {
  it("compares objects partially, arrays by length and order, scalars strictly", () => {
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 }, "x")).toBeNull();
    expect(
      firstDifference({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3, d: 0 }] } }, "x")
    ).toEqual({
      path: "x.a.b[1].c",
      expected: 2,
      actual: 3,
    });
    expect(firstDifference([1], [1, 2], "x")).toEqual({ path: "x.length", expected: 1, actual: 2 });
    expect(firstDifference({ a: null }, {}, "x")).toBeNull();
    expect(firstDifference({ a: 1 }, {}, "x")).toEqual({
      path: "x.a",
      expected: 1,
      actual: undefined,
    });
    expect(firstDifference({ a: "1" }, { a: 1 }, "x")).not.toBeNull();
    expect(firstDifference([{}], {}, "x")).toEqual({ path: "x", expected: [{}], actual: {} });
  });
});
