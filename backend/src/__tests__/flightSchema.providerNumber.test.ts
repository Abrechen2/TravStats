import { createFlightSchema, toProviderFlightNumber } from "../schemas/flight";

/**
 * Zero-padded flight numbers were invisible to every flight-data provider.
 *
 * Airlines print the padded form on itineraries ("EK051"), and that is what
 * the user types and what we store. AirLabs, Aviationstack and AeroDataBox
 * all key on the unpadded IATA form ("EK51") and answer a padded query with
 * an empty result set — so live tracking, auto-update and enrichment silently
 * did nothing for Emirates, Qatar, Gulf Air, EgyptAir and every other carrier
 * that pads.
 *
 * `toProviderFlightNumber` is the outgoing-request form ONLY. These tests pin
 * both halves of that contract: the query is unpadded, and the stored value
 * keeps the user's own spelling.
 */
describe("toProviderFlightNumber", () => {
  it("strips leading zeros from the number part", () => {
    expect(toProviderFlightNumber("EK051")).toBe("EK51");
  });

  it("strips a run of several zeros", () => {
    expect(toProviderFlightNumber("QR0007")).toBe("QR7");
  });

  it("leaves an already-unpadded number untouched", () => {
    expect(toProviderFlightNumber("LH123")).toBe("LH123");
  });

  it("normalises whitespace and case on the way (same as the stored form)", () => {
    expect(toProviderFlightNumber("  ek 051 ")).toBe("EK51");
  });

  it("handles the letter+digit IATA designator (easyJet)", () => {
    expect(toProviderFlightNumber("U20815")).toBe("U2815");
  });

  it("handles the digit+letter IATA designator (Jet Airways)", () => {
    expect(toProviderFlightNumber("9W0123")).toBe("9W123");
  });

  it("handles a three-letter ICAO designator", () => {
    expect(toProviderFlightNumber("DLH0400")).toBe("DLH400");
  });

  it("keeps a zero that is the whole number rather than padding", () => {
    // "LH0" is not padding around a number — there is no number left to keep.
    // Passed through unrecognised rather than mangled into "LH".
    expect(toProviderFlightNumber("LH0")).toBe("LH0");
  });

  it("passes an unrecognised shape through unchanged", () => {
    expect(toProviderFlightNumber("NOT-A-FLIGHT")).toBe("NOT-A-FLIGHT");
  });

  it("collapses empty and nullish input to undefined", () => {
    expect(toProviderFlightNumber("")).toBeUndefined();
    expect(toProviderFlightNumber("   ")).toBeUndefined();
    expect(toProviderFlightNumber(null)).toBeUndefined();
    expect(toProviderFlightNumber(undefined)).toBeUndefined();
  });
});

describe("the stored flight number keeps its padding", () => {
  const validBase = {
    departure: { iata: "DXB", lat: 25.2528, lon: 55.3644 },
    arrival: { iata: "MUC", lat: 48.3538, lon: 11.7861 },
    departureLocal: "2026-05-01T08:00",
    depTimezone: "Asia/Dubai",
    arrivalLocal: "2026-05-01T12:00",
    arrTimezone: "Europe/Berlin",
  };

  it("does NOT strip zeros at the schema boundary", () => {
    // The counterpart to the provider form: if the schema stripped padding,
    // the user's itinerary and the app would disagree on the flight number.
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "EK051" });
    expect(result.flightNumber).toBe("EK051");
  });
});
