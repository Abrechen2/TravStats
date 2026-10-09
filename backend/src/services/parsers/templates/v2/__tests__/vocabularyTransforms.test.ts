import { describe, it, expect } from "@jest/globals";
import { applyTransforms } from "../transforms";
import { validateEnvelope } from "../envelope";
import { applyTemplate, envelopeMatches } from "../runners";
import { EXTRACT_TIMEOUT_MS } from "../extract";
import { validTemplate } from "./fixtures";

/** The transforms and matcher conditions plan 2026-10-09 P4b added; invented inputs only. */
describe("v2 transforms added in P4b", () => {
  it.each([
    ["Flexpreis, 1. Klasse", "first"],
    ["Klasse: 2", "second"],
    ["2nd class", "second"],
    ["1re classe", "first"],
    ["mit BahnCard 50 (1. Klasse), 2. Kl.", "second"],
    ["Normalpreis", null],
  ])("travelClass reads %s as %s", (input, expected) => {
    expect(applyTransforms(input, "travelClass")).toBe(expected);
  });

  it("dayMonthNear dates a day-month by the reference, rolling a January row of a December trip", () => {
    expect(applyTransforms("02.05. 2016-05-02", "dayMonthNear")).toBe("2016-05-02");
    expect(applyTransforms("01.01. 2024-12-30", "dayMonthNear")).toBe("2025-01-01");
    expect(applyTransforms("31.02. 2024-02-01", "dayMonthNear")).toBeNull();
    expect(applyTransforms("02.05.", "dayMonthNear")).toBeNull();
  });

  it("laterClock puts an earlier arrival clock on the next day", () => {
    expect(applyTransforms("2026-12-20T22:30 00:05", "laterClock")).toBe("2026-12-21T00:05");
    expect(applyTransforms("2026-12-31T22:30 0:05", "laterClock")).toBe("2027-01-01T00:05");
    expect(applyTransforms("2026-03-14T08:05 09:17", "laterClock")).toBe("2026-03-14T09:17");
    expect(applyTransforms("2026-03-14T08:05 25:00", "laterClock")).toBeNull();
  });

  it.each([
    ["€ 1.234,50", 1234.5, "EUR"],
    ["NOK 3.380", 3380, "NOK"],
    ["S$ 1.324,90", 1324.9, "SGD"],
    ["US$628,70", 628.7, "USD"],
    ["TEL 1.234,50", null, null],
    ["Gesamt € 10", null, null],
  ])("leadingAmount / leadingCurrency read %s", (line, amount, currency) => {
    expect(applyTransforms(line, "leadingAmount")).toBe(amount);
    expect(applyTransforms(line, "leadingCurrency")).toBe(currency);
  });

  it("amount is the shared money reader; negative or digit-less input is none", () => {
    expect(applyTransforms("1.084,50", "amount")).toBe(1084.5);
    expect(applyTransforms("1,234.50", "amount")).toBe(1234.5);
    expect(applyTransforms("EUR", "amount")).toBeNull();
  });

  it("the address transforms split one printed line", () => {
    const line = "Anhalter Str. 2, Friedrichshain-Kreuzberg, 10963 Berlin, Deutschland";
    expect(applyTransforms(line, "addressStreet")).toBe(
      "Anhalter Str. 2, Friedrichshain-Kreuzberg"
    );
    expect(applyTransforms(line, "addressPostcode")).toBe("10963");
    expect(applyTransforms(line, "addressCity")).toBe("Berlin");
    expect(applyTransforms(line, "addressCountry")).toBe("Deutschland");
    expect(applyTransforms("4949 Regent Boulevard, Irving, TX 75063, USA", "addressCity")).toBe(
      "Irving"
    );
  });

  it("dates read French and Dutch month names too", () => {
    expect(applyTransforms("12 juin 2026", "date")).toBe("2026-06-12");
    expect(applyTransforms("3 mei 2026", "date")).toBe("2026-05-03");
  });
});

describe("v2 matcher conditions added in P4b", () => {
  const base = validTemplate();

  it("allOf, anyOf and noneOf regexes, each with its own flags", () => {
    const t = {
      ...base,
      match: {
        markers: [],
        anchors: [],
        anyOf: [{ pattern: "\\bSIXT\\b", flags: "" }],
        allOf: ["buchung\\s+ist\\s+best[äa]tigt"],
        noneOf: [{ pattern: "^Fahrkarte$", flags: "m" }],
      },
    };
    expect(envelopeMatches(t, "SIXT\nIhre Buchung ist\nbestätigt")).toBe(true);
    expect(envelopeMatches(t, "sixt\nIhre Buchung ist bestätigt")).toBe(false);
    expect(envelopeMatches(t, "SIXT\nIhre Buchung ist bestätigt\nFahrkarte")).toBe(false);
  });

  it("a condition confined to the sender reads only the sender", () => {
    const t = {
      ...base,
      match: { markers: [], anchors: [], anyOf: [{ pattern: "sixt", in: "from" as const }] },
    };
    expect(envelopeMatches(t, { from: "a@sixt.com", text: "Hallo" })).toBe(true);
    expect(envelopeMatches(t, { from: "a@example.com", text: "sixt" })).toBe(false);
  });

  it("refuses a matcher with nothing that identifies the issuer, and an output for a domain without one", () => {
    const empty = validateEnvelope({ ...base, match: { markers: ["x"], anchors: [] } });
    expect(empty.ok).toBe(false);
    const cruise = validateEnvelope({
      ...base,
      id: "cruise:x",
      domain: "cruise",
      output: { report: [] },
    });
    expect(cruise.ok ? [] : cruise.errors).toContain("output: cruise takes no output");
    const badLodging = validateEnvelope({
      ...base,
      output: { confidence: { complete: 101, partial: 1 } },
    });
    expect(badLodging.ok).toBe(false);
  });

  it("notBookingIf takes flags too", () => {
    const t = {
      ...base,
      match: { ...base.match, notBookingIf: [{ pattern: "STORNO", flags: "" }] },
    };
    const text = "Example Hotels\nReservierung Nr. ABC123";
    expect(applyTemplate(t, `${text}\nstorno`).nonBooking).toBeUndefined();
    expect(applyTemplate(t, `${text}\nSTORNO`).nonBooking).toBe(true);
  });

  it("runs the matcher's regexes under the extraction's bound, for this document only", () => {
    const slow = {
      ...base,
      match: { markers: [], anchors: [], anyOf: ["^(a+)+$"] },
    };
    const started = Date.now();
    expect(envelopeMatches(slow, `${"a".repeat(40)}!`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(EXTRACT_TIMEOUT_MS + 1500);
    // Nothing is remembered across documents: the same template reads the next one.
    expect(envelopeMatches(slow, "aaa")).toBe(true);
  });
});
