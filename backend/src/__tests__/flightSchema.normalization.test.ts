import { createFlightSchema, normalizeFlightNumber } from "../schemas/flight";

/**
 * Issue #84: re-importing a boarding pass for a flight that already
 * existed silently created a duplicate. Root cause: the POST /flights
 * duplicate-check compared the incoming `flightNumber` to stored
 * values as raw strings, but boarding-pass parsers and manual entry
 * emit the same flight as "LH 123", "LH123", "lh123" etc., so equal
 * flights compared unequal.
 *
 * Fix: normalize flightNumber at the schema boundary (whitespace
 * stripped, uppercase) so every write path persists the same
 * canonical form. These unit tests pin that contract.
 */
describe("createFlightSchema flightNumber normalization", () => {
  const validBase = {
    departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
    arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
    departureLocal: "2026-05-01T08:00",
    depTimezone: "Europe/Berlin",
    arrivalLocal: "2026-05-01T17:00",
    arrTimezone: "America/New_York",
  };

  it("strips internal whitespace from flight numbers", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "LH 123" });
    expect(result.flightNumber).toBe("LH123");
  });

  it("uppercases mixed-case flight numbers", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "lh123" });
    expect(result.flightNumber).toBe("LH123");
  });

  it("collapses multiple whitespace runs and uppercases together", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "  lh   0123  " });
    expect(result.flightNumber).toBe("LH0123");
  });

  it("treats empty string as undefined (no flight number)", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "" });
    expect(result.flightNumber).toBeUndefined();
  });

  it("treats whitespace-only string as undefined", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "   " });
    expect(result.flightNumber).toBeUndefined();
  });

  it("leaves an already-canonical flight number unchanged", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "LH123" });
    expect(result.flightNumber).toBe("LH123");
  });

  it("preserves alphabetic suffixes (regional / charter codes)", () => {
    const result = createFlightSchema.parse({ ...validBase, flightNumber: "ba 287a" });
    expect(result.flightNumber).toBe("BA287A");
  });
});

describe("normalizeFlightNumber (exported helper)", () => {
  it("strips whitespace and uppercases", () => {
    expect(normalizeFlightNumber("lh 400")).toBe("LH400");
    expect(normalizeFlightNumber(" LH400 ")).toBe("LH400");
    expect(normalizeFlightNumber("Lh400")).toBe("LH400");
  });

  it("returns undefined for nullish or empty input", () => {
    expect(normalizeFlightNumber(undefined)).toBeUndefined();
    expect(normalizeFlightNumber("")).toBeUndefined();
    expect(normalizeFlightNumber("   ")).toBeUndefined();
  });

  it("handles non-Latin whitespace classes", () => {
    expect(normalizeFlightNumber("LH\t400")).toBe("LH400");
    expect(normalizeFlightNumber("LH 400")).toBe("LH400");
  });
});

describe("dataSource enum (v1.5 imported_*)", () => {
  it("accepts the three new imported_* values", () => {
    for (const v of ["imported_fr24", "imported_generic_csv", "imported_roundtrip"]) {
      const result = createFlightSchema.safeParse({
        airline: "LH",
        flightNumber: "LH400",
        departureLocal: "2024-01-01T10:00:00",
        depTimezone: "Europe/Berlin",
        arrivalLocal: "2024-01-01T13:00:00",
        arrTimezone: "America/New_York",
        departure: { iata: "FRA", name: "Frankfurt", lat: 50, lon: 8 },
        arrival: { iata: "JFK", name: "JFK", lat: 40, lon: -73 },
        dataSource: v,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown dataSource values", () => {
    const result = createFlightSchema.safeParse({
      airline: "LH",
      flightNumber: "LH400",
      departureLocal: "2024-01-01T10:00:00",
      depTimezone: "Europe/Berlin",
      arrivalLocal: "2024-01-01T13:00:00",
      arrTimezone: "America/New_York",
      departure: { iata: "FRA", name: "Frankfurt", lat: 50, lon: 8 },
      arrival: { iata: "JFK", name: "JFK", lat: 40, lon: -73 },
      dataSource: "imported_someUnknownThing",
    });
    expect(result.success).toBe(false);
  });
});
